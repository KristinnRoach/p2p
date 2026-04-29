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

/**
 * Watch a mesh room's presence without joining it. Call room.join() to enter
 * presence and start connecting to peers.
 *
 * @param {Object} options
 * @returns {Promise<P2PRoom>}
 */
export async function watchP2PRoom(options = {}) {
  const room = new P2PRoom({ ...options, autoJoin: false });
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
      createSignaling = null,
      roomId = null,
      peerId,
      localStream = null,
      getLocalStream = null,
      rtcConfig,
      audioOnly = false,
      dataChannel = false,
      dataChannelLabel = 'data',
      startTimeoutMs = 8000,
      dataChannelOpenTimeoutMs = dataChannel ? 10000 : 0,
      maxPeers = Infinity,
      autoJoin = true,
      signal = null,
      onPeerStream = null,
      onPeerTrack = null,
      onPeerJoined = null,
      onPeerLeft = null,
      onFull = null,
      onLocalStream = null,
      onDataChannel = null,
      onDataChannelOpen = null,
      onDataChannelMessage = null,
      onDataChannelClose = null,
    } = options;

    if (!peerId) throw new Error('P2PRoom: peerId is required');
    if (!signaling && !createSignaling) {
      throw new Error('P2PRoom: signaling or createSignaling is required');
    }
    if (signaling && createSignaling) {
      throw new Error('P2PRoom: pass either signaling or createSignaling');
    }
    if (localStream && getLocalStream) {
      throw new Error('P2PRoom: pass either localStream or getLocalStream');
    }
    if (createSignaling && !roomId) {
      throw new Error('P2PRoom: roomId is required with createSignaling');
    }
    if (
      typeof maxPeers !== 'number' ||
      Number.isNaN(maxPeers) ||
      maxPeers <= 0
    ) {
      throw new Error('P2PRoom: maxPeers must be a positive number');
    }

    this.signaling = signaling ? createRoomSignaling(signaling) : null;
    this._createSignaling = createSignaling;
    this._signalingPromise = null;
    this.roomId = roomId;
    this.peerId = peerId;
    this.localStream = localStream;
    this._getLocalStream = getLocalStream;
    this._localStreamPromise = null;
    this._ownsLocalStream = false;
    this.rtcConfig = rtcConfig;
    this.audioOnly = audioOnly;
    this.dataChannel = dataChannel;
    this.dataChannelLabel = dataChannelLabel;
    this.startTimeoutMs = startTimeoutMs;
    this.dataChannelOpenTimeoutMs = dataChannelOpenTimeoutMs;
    this.maxPeers = maxPeers;
    this.autoJoin = autoJoin;
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
    this._peerIds = [];
    this._state = 'watching';
    this._joinPromise = null;
    this._leavePromise = null;
    this._joinStarted = false;
    this._joined = false;

    if (onPeerStream) this._cleanups.push(this.on('peerStream', onPeerStream));
    if (onPeerTrack) this._cleanups.push(this.on('peerTrack', onPeerTrack));
    if (onPeerJoined) this._cleanups.push(this.on('peerJoined', onPeerJoined));
    if (onPeerLeft) this._cleanups.push(this.on('peerLeft', onPeerLeft));
    if (onFull) this._cleanups.push(this.on('full', onFull));
    if (onLocalStream) {
      this._cleanups.push(this.on('localStream', onLocalStream));
    }
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
    if (this._state === 'closed') return;
    this._state = 'closed';

    for (const cleanup of this._cleanups.splice(0)) cleanup();
    this._closeAllPeers({ emitLeft: false });

    if (this._joinStarted || this._joined) {
      try {
        Promise.resolve(this.signaling?.leave(this.peerId)).catch(() => {});
      } catch (_) {}
    }
    try {
      Promise.resolve(this.signaling?.close?.()).catch(() => {});
    } catch (_) {}
    this._releaseOwnedLocalStream();
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

  join() {
    if (this._state === 'closed') {
      return Promise.reject(new Error('P2PRoom.join: room is closed'));
    }
    if (this._state === 'active') return Promise.resolve();
    if (this._joinPromise) return this._joinPromise;

    this._joinPromise = this._join();
    this._joinPromise.then(
      () => {
        this._joinPromise = null;
      },
      () => {
        this._joinPromise = null;
      },
    );
    return this._joinPromise;
  }

  leave() {
    if (this._state === 'closed') return Promise.resolve();
    if (this._state === 'watching') return Promise.resolve();
    if (this._leavePromise) return this._leavePromise;

    this._leavePromise =
      this._state === 'joining' && this._joinPromise
        ? this._leaveAfterJoin()
        : this._leave();
    this._leavePromise.then(
      () => {
        this._leavePromise = null;
      },
      () => {
        this._leavePromise = null;
      },
    );
    return this._leavePromise;
  }

  async _start() {
    if (this.signal?.aborted) throw createAbortError();
    await this._ensureSignaling();
    if (this._state === 'closed' || this.signal?.aborted) {
      throw createAbortError();
    }
    const cleanup = this.signaling.onPeers((peerIds) => {
      this._peerIds = [...peerIds];
      if (
        (this._state === 'watching' || this._state === 'joining') &&
        this._isFull(peerIds)
      ) {
        this._emitFull(peerIds);
      }
      this._syncPeers(peerIds);
    });
    if (typeof cleanup === 'function') this._cleanups.push(cleanup);

    let abortPromise = null;
    if (this.signal) {
      abortPromise = new Promise((_, reject) => {
        const abortHandler = () => {
          this.close();
          reject(createAbortError());
        };
        this.signal.addEventListener('abort', abortHandler, { once: true });
        this._cleanups.push(() => {
          this.signal.removeEventListener('abort', abortHandler);
        });
      });
    }

    if (!this.autoJoin) {
      abortPromise?.catch(() => {});
      return;
    }
    const joinPromise = this.join();
    if (abortPromise) await Promise.race([joinPromise, abortPromise]);
    else await joinPromise;

    if (this._state === 'closed' || this.signal?.aborted) {
      throw createAbortError();
    }
  }

  async _join() {
    if (this._state === 'leaving' && this._leavePromise) {
      await this._leavePromise;
    }
    if (this._state === 'closed') {
      throw new Error('P2PRoom.join: room is closed');
    }
    if (this._state === 'active') return;
    if (this._isFull()) {
      this._emitFull();
      throw createRoomFullError();
    }

    this._state = 'joining';
    this._joinStarted = true;
    try {
      await this._ensureLocalStream();
    } catch (error) {
      this._joinStarted = false;
      if (this._state !== 'closed') this._state = 'watching';
      throw error;
    }
    if (this._state === 'closed' || this.signal?.aborted) {
      throw createAbortError();
    }
    try {
      await Promise.resolve(this.signaling.join(this.peerId));
    } catch (error) {
      this._joinStarted = false;
      this._releaseOwnedLocalStream();
      if (this._state !== 'closed') this._state = 'watching';
      throw error;
    }
    this._joined = true;
    if (this._state === 'closed' || this.signal?.aborted) {
      throw createAbortError();
    }
    if (this._state !== 'joining') return;
    if (this._isFull()) {
      try {
        await Promise.resolve(this.signaling.leave(this.peerId));
      } finally {
        this._joinStarted = false;
        this._joined = false;
        this._state = 'watching';
        this._releaseOwnedLocalStream();
      }
      this._emitFull();
      throw createRoomFullError();
    }
    this._state = 'active';
    this._syncPeers(this._peerIds);
  }

  async _leave() {
    this._state = 'leaving';
    this._closeAllPeers({ emitLeft: true });
    try {
      if (this._joined || this._joinStarted) {
        await Promise.resolve(this.signaling.leave(this.peerId));
        this._joinStarted = false;
        this._joined = false;
      }
    } finally {
      this._releaseOwnedLocalStream();
    }
    if (this._state !== 'closed') this._state = 'watching';
  }

  async _leaveAfterJoin() {
    this._state = 'leaving';
    await this._joinPromise.catch(() => {});
    if (this._state !== 'closed') await this._leave();
  }

  _syncPeers(peerIds) {
    if (this._state !== 'active') return;
    const allowedPeerIds = this._allowedPeerIds(peerIds);
    const remotePeerIds = new Set(
      allowedPeerIds.filter((id) => id !== this.peerId),
    );
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
      this._state !== 'active'
    ) {
      return;
    }

    const controller = new AbortController();
    const pairSignaling = this.signaling.createPeerSignaling({
      localPeerId: this.peerId,
      remotePeerId,
    });
    const role = this.peerId < remotePeerId ? 'initiator' : 'joiner';
    const createSession =
      role === 'initiator' ? startP2PSession : joinP2PSession;

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
        this._emit('peerStream', {
          peerId: remotePeerId,
          stream,
          track,
          event,
        });
      },
      onRemoteTrack: ({ stream, track, event }) => {
        this._emit('peerTrack', { peerId: remotePeerId, stream, track, event });
      },
      onDataChannel: ({ channel }) => {
        this._bindDataChannel(remotePeerId, channel);
      },
    })
      .then((pair) => {
        if (this._state !== 'active' || controller.signal.aborted) {
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
        if (!controller.signal.aborted && this._state !== 'closed') {
          this._emit('error', { peerId: remotePeerId, error });
        }
        this._closePeer(remotePeerId, { emitLeft: false });
      });
  }

  async _ensureSignaling() {
    if (this.signaling) return this.signaling;
    if (!this._signalingPromise) {
      this._signalingPromise = Promise.resolve()
        .then(() => this._createSignaling({ roomId: this.roomId }))
        .then((signaling) => createRoomSignaling(signaling));
    }

    const signaling = await this._signalingPromise;
    if (this._state === 'closed') {
      try {
        signaling.close?.();
      } catch (_) {}
      throw createAbortError();
    }
    this.signaling = signaling;
    return signaling;
  }

  async _ensureLocalStream() {
    if (this.localStream || !this._getLocalStream) return this.localStream;
    if (!this._localStreamPromise) {
      this._localStreamPromise = Promise.resolve()
        .then(() => this._getLocalStream())
        .then((stream) => {
          if (!stream) return null;
          if (this._state === 'closed' || this.signal?.aborted) {
            stopStream(stream);
            throw createAbortError();
          }
          this.localStream = stream;
          this._ownsLocalStream = true;
          this._emit('localStream', { stream });
          return stream;
        })
        .finally(() => {
          this._localStreamPromise = null;
        });
    }
    return this._localStreamPromise;
  }

  _releaseOwnedLocalStream() {
    if (!this._ownsLocalStream) return;
    stopStream(this.localStream);
    this.localStream = null;
    this._ownsLocalStream = false;
  }

  _closeAllPeers({ emitLeft = true } = {}) {
    const peerIds = new Set([
      ...this.pairs.keys(),
      ...this._controllers.keys(),
      ...this.remoteStreams.keys(),
      ...this.dataChannels.keys(),
      ...this._pairSignalings.keys(),
    ]);
    for (const peerId of peerIds) this._closePeer(peerId, { emitLeft });
  }

  _closePeer(peerId, { emitLeft = true } = {}) {
    this._controllers.get(peerId)?.abort();
    this._controllers.delete(peerId);
    this.pairs.get(peerId)?.close();
    this.pairs.delete(peerId);
    this._pairSignalings.get(peerId)?.close?.();
    this._pairSignalings.delete(peerId);
    this._closeDataChannel(peerId);
    const stream = this.remoteStreams.get(peerId) ?? null;
    this.remoteStreams.delete(peerId);
    if (emitLeft) this._emit('peerLeft', { peerId, stream });
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
    if (this._state !== 'active') return;
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

  _emitFull(peerIds = this._peerIds) {
    this._emit('full', {
      peerIds: [...peerIds],
      maxPeers: this.maxPeers,
    });
  }

  _isFull(peerIds = this._peerIds) {
    if (!Number.isFinite(this.maxPeers)) return false;
    if (peerIds.includes(this.peerId)) return false;
    return peerIds.length >= this.maxPeers;
  }

  _allowedPeerIds(peerIds) {
    if (!Number.isFinite(this.maxPeers)) return peerIds;
    if (peerIds.includes(this.peerId)) return peerIds;
    return peerIds.slice(0, Math.max(0, this.maxPeers - 1));
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

function createRoomFullError() {
  const error = new Error('P2PRoom.join: room is full');
  error.name = 'RoomFullError';
  return error;
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

function stopStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}
