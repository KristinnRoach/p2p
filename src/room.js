import { startP2PSession, joinP2PSession } from './session.js';
import { createRoomSignaling } from './signaling.js';

/**
 * Join a mesh room for N-way group calls. Each remote peer gets its own
 * underlying 1:1 {@link P2PSession} managed automatically. For simple 1:1
 * calls use {@link startP2PSession} / {@link joinP2PSession} instead.
 *
 * @param {Object} options
 * @returns {Promise<P2PRoom>}
 */
export async function joinP2PRoom(options = {}) {
  const room = new P2PRoom(options);
  try {
    await room.ready;
    return room;
  } catch (error) {
    room.close();
    throw error;
  }
}

export class P2PRoom extends EventTarget {
  constructor(options = {}) {
    super();
    const {
      signaling,
      peerId,
      localStream = null,
      rtcConfig,
      audioOnly = false,
      dataChannel = false,
      dataChannelLabel = 'data',
      startTimeoutMs = 8000,
      dataChannelOpenTimeoutMs = dataChannel ? 10000 : 0,
      signal = null,
      onPeerStream = null,
      onPeerTrack = null,
      onPeerJoined = null,
      onPeerLeft = null,
      onDataChannel = null,
      onDataChannelOpen = null,
      onDataChannelMessage = null,
      onDataChannelClose = null,
    } = options;

    if (!peerId) throw new Error('P2PRoom: peerId is required');

    this.signaling = createRoomSignaling(signaling);
    this.peerId = peerId;
    this.localStream = localStream;
    this.rtcConfig = rtcConfig;
    this.audioOnly = audioOnly;
    this.dataChannel = dataChannel;
    this.dataChannelLabel = dataChannelLabel;
    this.startTimeoutMs = startTimeoutMs;
    this.dataChannelOpenTimeoutMs = dataChannelOpenTimeoutMs;
    this.signal = signal;

    /** @type {Map<string, import('./session.js').P2PSession>} one entry per connected remote peer */
    this.pairs = new Map();
    this.remoteStreams = new Map();
    this.dataChannels = new Map();
    this._controllers = new Map();
    this._pairSignalings = new Map();
    this._dataChannelCleanups = new Map();
    this._cleanups = [];
    this._listenerMap = new Map();
    this._closed = false;

    if (onPeerStream) this._cleanups.push(this.on('peerStream', onPeerStream));
    if (onPeerTrack) this._cleanups.push(this.on('peerTrack', onPeerTrack));
    if (onPeerJoined) this._cleanups.push(this.on('peerJoined', onPeerJoined));
    if (onPeerLeft) this._cleanups.push(this.on('peerLeft', onPeerLeft));
    if (onDataChannel) {
      this._cleanups.push(this.on('dataChannel', onDataChannel));
    }
    if (onDataChannelOpen) {
      this._cleanups.push(this.on('dataChannelOpen', onDataChannelOpen));
    }
    if (onDataChannelMessage) {
      this._cleanups.push(this.on('dataChannelMessage', onDataChannelMessage));
    }
    if (onDataChannelClose) {
      this._cleanups.push(this.on('dataChannelClose', onDataChannelClose));
    }

    this.ready = this._start();
  }

  close() {
    if (this._closed) return;
    this._closed = true;

    for (const cleanup of this._cleanups.splice(0)) cleanup();
    for (const controller of this._controllers.values()) controller.abort();
    this._controllers.clear();
    for (const pair of this.pairs.values()) pair.close();
    this.pairs.clear();
    for (const signaling of this._pairSignalings.values()) {
      signaling.close?.();
    }
    this._pairSignalings.clear();
    for (const peerId of [...this.dataChannels.keys()]) {
      this._closeDataChannel(peerId);
    }
    this.remoteStreams.clear();

    try {
      this.signaling.leave(this.peerId);
    } catch (_) {}
    try {
      this.signaling.close?.();
    } catch (_) {}
  }

  on(type, callback) {
    const handler = (event) => callback(event.detail, event);
    this._trackListener(type, callback, handler);
    this.addEventListener(type, handler);
    return () => {
      this.removeEventListener(type, handler);
      this._forgetListener(type, callback, handler);
    };
  }

  off(type, callback) {
    const handlers = this._listenerMap.get(type)?.get(callback);
    if (handlers) {
      for (const handler of handlers) this.removeEventListener(type, handler);
      this._listenerMap.get(type)?.delete(callback);
      return;
    }
    this.removeEventListener(type, callback);
  }

  async _start() {
    if (this.signal?.aborted) throw createAbortError();
    const cleanup = this.signaling.onPeers((peerIds) => {
      this._syncPeers(peerIds);
    });
    if (typeof cleanup === 'function') this._cleanups.push(cleanup);

    if (this.signal) {
      const abortHandler = () => this.close();
      this.signal.addEventListener('abort', abortHandler, { once: true });
      this._cleanups.push(() => {
        this.signal.removeEventListener('abort', abortHandler);
      });
    }

    await this.signaling.join(this.peerId);
  }

  _syncPeers(peerIds) {
    if (this._closed) return;
    const remotePeerIds = new Set(peerIds.filter((id) => id !== this.peerId));
    for (const peerId of remotePeerIds) this._connectPeer(peerId);
    for (const peerId of this.pairs.keys()) {
      if (!remotePeerIds.has(peerId)) this._closePeer(peerId);
    }
    for (const peerId of this._controllers.keys()) {
      if (!remotePeerIds.has(peerId)) this._closePeer(peerId);
    }
  }

  _connectPeer(remotePeerId) {
    if (
      this.pairs.has(remotePeerId) ||
      this._controllers.has(remotePeerId) ||
      this._closed
    ) {
      return;
    }

    const controller = new AbortController();
    const pairSignaling = this.signaling.createPeerSignaling({
      localPeerId: this.peerId,
      remotePeerId,
    });
    const role = this.peerId < remotePeerId ? 'initiator' : 'joiner';
    const createSession = role === 'initiator' ? startP2PSession : joinP2PSession;

    this._controllers.set(remotePeerId, controller);
    this._pairSignalings.set(remotePeerId, pairSignaling);
    this._emit('peerJoined', { peerId: remotePeerId });

    createSession({
      signaling: pairSignaling,
      localStream: this.localStream,
      rtcConfig: this.rtcConfig,
      audioOnly: this.audioOnly,
      dataChannel: this.dataChannel,
      dataChannelLabel: this.dataChannelLabel,
      startTimeoutMs: this.startTimeoutMs,
      dataChannelOpenTimeoutMs: this.dataChannelOpenTimeoutMs,
      signal: controller.signal,
      onRemoteStream: ({ stream, track, event }) => {
        this.remoteStreams.set(remotePeerId, stream);
        this._emit('peerStream', { peerId: remotePeerId, stream, track, event });
      },
      onRemoteTrack: ({ stream, track, event }) => {
        this._emit('peerTrack', { peerId: remotePeerId, stream, track, event });
      },
      onDataChannel: ({ channel }) => {
        this._bindDataChannel(remotePeerId, channel);
      },
    })
      .then((pair) => {
        if (this._closed || controller.signal.aborted) {
          pair.close();
          pairSignaling.close?.();
          return;
        }
        this.pairs.set(remotePeerId, pair);
        this._controllers.delete(remotePeerId);
        if (pair.dataChannel) {
          this._bindDataChannel(remotePeerId, pair.dataChannel);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && !this._closed) {
          this._emit('error', { peerId: remotePeerId, error });
        }
        this._closePeer(remotePeerId);
      });
  }

  _closePeer(peerId) {
    this._controllers.get(peerId)?.abort();
    this._controllers.delete(peerId);
    this.pairs.get(peerId)?.close();
    this.pairs.delete(peerId);
    this._pairSignalings.get(peerId)?.close?.();
    this._pairSignalings.delete(peerId);
    this._closeDataChannel(peerId);
    const stream = this.remoteStreams.get(peerId) ?? null;
    this.remoteStreams.delete(peerId);
    this._emit('peerLeft', { peerId, stream });
  }

  send(peerId, data) {
    const pair = this.pairs.get(peerId);
    if (!pair) throw new Error(`P2PRoom.send: unknown peer "${peerId}"`);
    pair.send(data);
  }

  broadcast(data) {
    let sent = 0;
    for (const pair of this.pairs.values()) {
      if (pair.dataChannel?.readyState !== 'open') continue;
      pair.send(data);
      sent += 1;
    }
    return sent;
  }

  _bindDataChannel(peerId, channel) {
    if (this._closed) return;
    if (this.dataChannels.get(peerId) === channel) return;

    this._closeDataChannel(peerId);
    this.dataChannels.set(peerId, channel);
    this._emit('dataChannel', { peerId, channel });

    const onOpen = () => this._emit('dataChannelOpen', { peerId, channel });
    const onMessage = (event) => {
      this._emit('dataChannelMessage', { peerId, channel, data: event.data });
    };
    const onClose = () => this._emit('dataChannelClose', { peerId, channel });

    channel.addEventListener('open', onOpen);
    channel.addEventListener('message', onMessage);
    channel.addEventListener('close', onClose);

    this._dataChannelCleanups.set(peerId, () => {
      channel.removeEventListener('open', onOpen);
      channel.removeEventListener('message', onMessage);
      channel.removeEventListener('close', onClose);
    });

    if (channel.readyState === 'open') onOpen();
  }

  _closeDataChannel(peerId) {
    this._dataChannelCleanups.get(peerId)?.();
    this._dataChannelCleanups.delete(peerId);
    this.dataChannels.delete(peerId);
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _trackListener(type, callback, handler) {
    if (!this._listenerMap.has(type)) {
      this._listenerMap.set(type, new Map());
    }
    const callbacks = this._listenerMap.get(type);
    if (!callbacks.has(callback)) {
      callbacks.set(callback, new Set());
    }
    callbacks.get(callback).add(handler);
  }

  _forgetListener(type, callback, handler) {
    const handlers = this._listenerMap.get(type)?.get(callback);
    handlers?.delete(handler);
    if (handlers?.size === 0) {
      this._listenerMap.get(type)?.delete(callback);
    }
  }
}

function createAbortError() {
  try {
    return new DOMException('P2PRoom: aborted', 'AbortError');
  } catch (_) {
    const error = new Error('P2PRoom: aborted');
    error.name = 'AbortError';
    return error;
  }
}
