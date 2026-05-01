import { startP2PSession, joinP2PSession } from './session.js';
import { createRoomSignaling } from './signaling.js';
import { log } from './logger.js';

const PRESENCE_HEARTBEAT_MS = 5000;

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
      memberCapacity = options.maxPeers ?? Infinity,
      autoJoin = true,
      signal = null,
      onMemberStream = null,
      onMemberTrack = null,
      onMemberJoined = null,
      onMemberLeft = null,
      onMembersChanged = null,
      onStateChange = null,
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
      onError = null,
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
      typeof memberCapacity !== 'number' ||
      Number.isNaN(memberCapacity) ||
      memberCapacity <= 0
    ) {
      throw new Error('P2PRoom: memberCapacity must be a positive number');
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
    this.memberCapacity = memberCapacity;
    this.maxPeers = memberCapacity;
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
    this._memberIds = [];
    this._state = 'watching';
    this._joinPromise = null;
    this._leavePromise = null;
    this._joinStarted = false;
    this._joined = false;
    this._presenceHeartbeatTimer = null;
    this._pagehideCleanup = null;

    if (onMemberStream) {
      this._cleanups.push(this.on('memberStream', onMemberStream));
    }
    if (onMemberTrack) {
      this._cleanups.push(this.on('memberTrack', onMemberTrack));
    }
    if (onMemberJoined) {
      this._cleanups.push(this.on('memberJoined', onMemberJoined));
    }
    if (onMemberLeft) this._cleanups.push(this.on('memberLeft', onMemberLeft));
    if (onMembersChanged) {
      this._cleanups.push(this.on('membersChanged', onMembersChanged));
    }
    if (onStateChange)
      this._cleanups.push(this.on('statechange', onStateChange));
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
    if (onError) this._cleanups.push(this.on('error', onError));

    this.ready = this._start();
  }

  get members() {
    return [...this._memberIds];
  }

  get memberCount() {
    return this._memberIds.length;
  }

  get remoteMemberStreams() {
    const streams = [];
    const seen = new Set();

    for (const memberId of this._memberIds) {
      const stream = this.remoteStreams.get(memberId);
      if (!stream) continue;
      streams.push({ memberId, stream });
      seen.add(memberId);
    }

    for (const [memberId, stream] of this.remoteStreams) {
      if (!seen.has(memberId)) streams.push({ memberId, stream });
    }

    return streams;
  }

  get isFull() {
    return this._isFull();
  }

  get state() {
    return toPublicState(this._state);
  }

  close() {
    if (this._state === 'closed') return;
    this._setState('closed');

    this._stopPresenceHeartbeat();
    this._unbindPagehideLeave();
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
    const cleanup = this.signaling.onPeers((memberIds) => {
      this._setMembers(memberIds);
      if (
        (this._state === 'watching' || this._state === 'joining') &&
        this._isFull(memberIds)
      ) {
        this._emitFull(memberIds);
      }
      this._syncMembers(memberIds);
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

    this._setState('joining');
    this._joinStarted = true;
    try {
      await this._ensureLocalStream();
    } catch (error) {
      this._joinStarted = false;
      if (this._state !== 'closed') this._setState('watching');
      throw error;
    }
    if (this._state === 'closed' || this.signal?.aborted) {
      this._joinStarted = false;
      this._releaseOwnedLocalStream();
      if (this._state !== 'closed') this._setState('watching');
      throw createAbortError();
    }
    let signaling;
    try {
      signaling = await this._ensureSignaling();
      if (this._state === 'closed' || this.signal?.aborted) {
        throw createAbortError();
      }
      await Promise.resolve(signaling.join(this.peerId));
    } catch (error) {
      this._joinStarted = false;
      this._releaseOwnedLocalStream();
      if (this._state !== 'closed') this._setState('watching');
      throw error;
    }
    this._joined = true;
    if (this._state === 'closed' || this.signal?.aborted) {
      try {
        await Promise.resolve(signaling.leave(this.peerId));
      } catch (_) {
        // Best-effort cleanup; preserve the abort outcome below.
      } finally {
        this._joinStarted = false;
        this._joined = false;
        this._releaseOwnedLocalStream();
        if (this._state !== 'closed') this._setState('watching');
      }
      throw createAbortError();
    }
    if (this._state !== 'joining') return;
    if (this._isFull()) {
      try {
        await Promise.resolve(signaling.leave(this.peerId));
      } catch (_) {
        // Best-effort cleanup; preserve the room-full outcome below.
      } finally {
        this._joinStarted = false;
        this._joined = false;
        this._setState('watching');
        this._releaseOwnedLocalStream();
      }
      this._emitFull();
      throw createRoomFullError();
    }
    this._setState('active');
    this._startPresenceHeartbeat(signaling);
    this._bindPagehideLeave(signaling);
    this._syncMembers(this._memberIds);
  }

  async _leave() {
    this._setState('leaving');
    this._closeAllPeers({ emitLeft: true });
    const shouldLeave = this._joined || this._joinStarted;
    try {
      if (shouldLeave) {
        const signaling = await this._ensureSignaling();
        await Promise.resolve(signaling.leave(this.peerId));
      }
    } finally {
      if (shouldLeave) {
        this._joinStarted = false;
        this._joined = false;
      }
      this._stopPresenceHeartbeat();
      this._unbindPagehideLeave();
      this._releaseOwnedLocalStream();
      if (this._state !== 'closed') this._setState('watching');
    }
  }

  _startPresenceHeartbeat(signaling) {
    this._stopPresenceHeartbeat();
    if (typeof signaling.refreshPresence !== 'function') return;

    this._presenceHeartbeatTimer = setInterval(() => {
      if (this._state !== 'active' || !this._joined) return;
      Promise.resolve()
        .then(() => signaling.refreshPresence(this.peerId))
        .catch((error) => {
          if (this._state !== 'closed') {
            this._emit('error', { peerId: this.peerId, error });
          }
        });
    }, PRESENCE_HEARTBEAT_MS);
  }

  _stopPresenceHeartbeat() {
    if (this._presenceHeartbeatTimer == null) return;
    clearInterval(this._presenceHeartbeatTimer);
    this._presenceHeartbeatTimer = null;
  }

  _bindPagehideLeave(signaling) {
    this._unbindPagehideLeave();
    if (typeof globalThis.addEventListener !== 'function') return;

    const onPagehide = (event) => {
      if (event?.persisted || !this._joined) return;
      try {
        Promise.resolve(signaling.leave(this.peerId)).catch(() => {});
      } catch (_) {}
    };

    globalThis.addEventListener('pagehide', onPagehide);
    this._pagehideCleanup = () => {
      globalThis.removeEventListener?.('pagehide', onPagehide);
    };
  }

  _unbindPagehideLeave() {
    this._pagehideCleanup?.();
    this._pagehideCleanup = null;
  }

  async _leaveAfterJoin() {
    this._setState('leaving');
    await this._joinPromise.catch(() => {});
    if (this._state !== 'closed') await this._leave();
  }

  _syncMembers(memberIds) {
    if (this._state !== 'active') return;
    const allowedMemberIds = this._allowedMemberIds(memberIds);
    const remoteMemberIds = new Set(
      allowedMemberIds.filter((id) => id !== this.peerId),
    );
    for (const memberId of remoteMemberIds) this._connectMember(memberId);
    for (const memberId of this.pairs.keys()) {
      if (!remoteMemberIds.has(memberId)) this._closeMember(memberId);
    }
    for (const memberId of this._controllers.keys()) {
      if (!remoteMemberIds.has(memberId)) this._closeMember(memberId);
    }
  }

  _connectMember(remoteMemberId) {
    if (
      this.pairs.has(remoteMemberId) ||
      this._controllers.has(remoteMemberId) ||
      this._state !== 'active'
    ) {
      return;
    }

    const controller = new AbortController();
    const pairSignaling = this.signaling.createPeerSignaling({
      localPeerId: this.peerId,
      remotePeerId: remoteMemberId,
    });
    const role = this.peerId < remoteMemberId ? 'initiator' : 'joiner';
    const createSession =
      role === 'initiator' ? startP2PSession : joinP2PSession;

    this._controllers.set(remoteMemberId, controller);
    this._pairSignalings.set(remoteMemberId, pairSignaling);
    this._emitMemberJoined(remoteMemberId);

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
        this.remoteStreams.set(remoteMemberId, stream);
        this._emitMemberStream({
          memberId: remoteMemberId,
          stream,
          track,
          event,
        });
      },
      onRemoteTrack: ({ stream, track, event }) => {
        this._emitMemberTrack({
          memberId: remoteMemberId,
          stream,
          track,
          event,
        });
      },
      onDataChannel: ({ channel }) => {
        this._bindDataChannel(remoteMemberId, channel);
      },
    })
      .then((pair) => {
        if (this._state !== 'active' || controller.signal.aborted) {
          pair.close();
          pairSignaling.close?.();
          return;
        }
        this.pairs.set(remoteMemberId, pair);
        this._controllers.delete(remoteMemberId);
        if (pair.dataChannel) {
          this._bindDataChannel(remoteMemberId, pair.dataChannel);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && this._state !== 'closed') {
          this._emit('error', {
            peerId: remoteMemberId,
            memberId: remoteMemberId,
            error,
          });
        }
        this._closeMember(remoteMemberId, { emitLeft: false });
      });
  }

  async _ensureSignaling() {
    if (this.signaling) return this.signaling;
    if (!this._signalingPromise) {
      this._signalingPromise = Promise.resolve()
        .then(() => {
          log(`[Room] createSignaling({ roomId: ${this.roomId})`);
          return this._createSignaling({ roomId: this.roomId });
        })
        .then((signaling) => createRoomSignaling(signaling))
        .catch((error) => {
          this._signalingPromise = null;
          throw error;
        });
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
        .catch((error) => {
          throw createLocalStreamError(error);
        })
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
    const memberIds = new Set([
      ...this.pairs.keys(),
      ...this._controllers.keys(),
      ...this.remoteStreams.keys(),
      ...this.dataChannels.keys(),
      ...this._pairSignalings.keys(),
    ]);
    for (const memberId of memberIds) this._closeMember(memberId, { emitLeft });
  }

  _closeMember(memberId, { emitLeft = true } = {}) {
    this._controllers.get(memberId)?.abort();
    this._controllers.delete(memberId);
    this.pairs.get(memberId)?.close();
    this.pairs.delete(memberId);
    this._pairSignalings.get(memberId)?.close?.();
    this._pairSignalings.delete(memberId);
    this._closeDataChannel(memberId);
    const stream = this.remoteStreams.get(memberId) ?? null;
    this.remoteStreams.delete(memberId);
    if (emitLeft) this._emitMemberLeft(memberId, stream);
  }

  send(memberId, data) {
    const pair = this.pairs.get(memberId);
    if (!pair) throw new Error(`P2PRoom.send: unknown member "${memberId}"`);
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

  _bindDataChannel(memberId, channel) {
    if (this._state !== 'active') return;
    if (this.dataChannels.get(memberId) === channel) return;

    this._closeDataChannel(memberId);
    this.dataChannels.set(memberId, channel);
    this._emit('dataChannel', { peerId: memberId, memberId, channel });

    const onOpen = () =>
      this._emit('dataChannelOpen', { peerId: memberId, memberId, channel });
    const onMessage = (event) => {
      this._emit('dataChannelMessage', {
        peerId: memberId,
        memberId,
        channel,
        data: event.data,
      });
    };
    const onClose = () =>
      this._emit('dataChannelClose', { peerId: memberId, memberId, channel });

    channel.addEventListener('open', onOpen);
    channel.addEventListener('message', onMessage);
    channel.addEventListener('close', onClose);

    this._dataChannelCleanups.set(memberId, () => {
      channel.removeEventListener('open', onOpen);
      channel.removeEventListener('message', onMessage);
      channel.removeEventListener('close', onClose);
    });

    if (channel.readyState === 'open') onOpen();
  }

  _closeDataChannel(memberId) {
    this._dataChannelCleanups.get(memberId)?.();
    this._dataChannelCleanups.delete(memberId);
    this.dataChannels.delete(memberId);
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _setState(nextState) {
    const previous = this.state;
    this._state = nextState;
    const state = this.state;
    if (state === previous) return;
    this._emit('statechange', { state, previous });
  }

  _setMembers(memberIds) {
    const nextMembers = [...memberIds];
    if (areSameMembers(this._memberIds, nextMembers)) return;
    this._memberIds = nextMembers;
    this._emitMembersChanged();
  }

  _emitMembersChanged() {
    this._emit('membersChanged', {
      members: this.members,
      memberCount: this.memberCount,
      memberCapacity: this.memberCapacity,
    });
  }

  _emitMemberJoined(memberId) {
    this._emit('memberJoined', { memberId });
    this._emit('peerJoined', { peerId: memberId, memberId });
  }

  _emitMemberLeft(memberId, stream) {
    this._emit('memberLeft', { memberId, stream });
    this._emit('peerLeft', { peerId: memberId, memberId, stream });
  }

  _emitMemberStream(detail) {
    this._emit('memberStream', detail);
    this._emit('peerStream', { ...detail, peerId: detail.memberId });
  }

  _emitMemberTrack(detail) {
    this._emit('memberTrack', detail);
    this._emit('peerTrack', { ...detail, peerId: detail.memberId });
  }

  _emitFull(memberIds = this._memberIds) {
    this._emit('full', {
      members: [...memberIds],
      memberCount: memberIds.length,
      memberCapacity: this.memberCapacity,
      peerIds: [...memberIds],
      maxPeers: this.memberCapacity,
    });
  }

  _isFull(memberIds = this._memberIds) {
    if (!Number.isFinite(this.memberCapacity)) return false;
    if (memberIds.includes(this.peerId)) return false;
    return memberIds.length >= this.memberCapacity;
  }

  _allowedMemberIds(memberIds) {
    if (!Number.isFinite(this.memberCapacity)) return memberIds;
    if (memberIds.includes(this.peerId)) return memberIds;
    return memberIds.slice(0, Math.max(0, this.memberCapacity - 1));
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

export class RoomFullError extends Error {
  constructor(message = 'P2PRoom.join: room is full') {
    super(message);
    this.name = 'RoomFullError';
  }
}

export class LocalStreamError extends Error {
  constructor(message = 'P2PRoom.join: local stream failed', options = {}) {
    super(message, { cause: options.cause });
    this.name = 'LocalStreamError';
    if (options.cause !== undefined && this.cause === undefined) {
      this.cause = options.cause;
    }
  }
}

export function isRoomFullError(error) {
  return error instanceof RoomFullError;
}

export function isLocalStreamError(error) {
  return error instanceof LocalStreamError;
}

function createRoomFullError() {
  return new RoomFullError();
}

function createLocalStreamError(cause) {
  return new LocalStreamError(undefined, { cause });
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

function areSameMembers(a, b) {
  if (a.length !== b.length) return false;
  return a.every((memberId, index) => memberId === b[index]);
}

function toPublicState(state) {
  return state === 'active' ? 'joined' : state;
}
