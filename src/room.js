import { startP2PSession, joinP2PSession } from './session.js';
import { createRoomSignaling } from './signaling.js';
import { log } from './logger.js';
import {
  assertLocalTrackKind,
  normalizeLocalTrackSlots,
} from './local-track-slots.js';

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
      localTrackSlots = [],
      rtcConfig,
      audioOnly = false,
      dataChannel = false,
      dataChannelLabel = 'data',
      startTimeoutMs = 8000,
      dataChannelOpenTimeoutMs = dataChannel ? 10000 : 0,
      memberCapacity = options.maxPeers ?? Infinity,
      presenceData = undefined,
      autoJoin = true,
      autoCloseWhenAlone = false,
      signal = null,
      onMemberStream = null,
      onMemberTrack = null,
      onMemberJoined = null,
      onMemberLeft = null,
      onMemberStreamRemoved = null,
      onAlone = null,
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
    if (presenceData !== undefined) {
      assertPresenceData(presenceData, 'P2PRoom');
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
    this._ownedLocalTracks = new Set();
    this._localTrackSlots = new Map(
      normalizeLocalTrackSlots(localTrackSlots, 'P2PRoom').map((slot) => [
        slot.id,
        slot,
      ]),
    );
    this._localTrackSlotVersion = 0;
    if (
      this._localTrackSlots.size > 0 &&
      !this.localStream &&
      !getLocalStream
    ) {
      this.localStream = new MediaStream();
    }
    this._syncAllSlotTracksToLocalStream();
    this.rtcConfig = rtcConfig;
    this.audioOnly = audioOnly;
    this.dataChannel = dataChannel;
    this.dataChannelLabel = dataChannelLabel;
    this.startTimeoutMs = startTimeoutMs;
    this.dataChannelOpenTimeoutMs = dataChannelOpenTimeoutMs;
    this.memberCapacity = memberCapacity;
    this.maxPeers = memberCapacity;
    this._presenceData = presenceData;
    this.autoJoin = autoJoin;
    this.autoCloseWhenAlone = autoCloseWhenAlone;
    this.signal = signal;

    /** @type {Map<string, import('./session.js').P2PSession>} one entry per connected remote peer */
    this.pairs = new Map();
    this.remoteStreams = new Map();
    this._remoteMemberStreamEntries = new Map();
    this.dataChannels = new Map();
    this._controllers = new Map();
    this._pairSignalings = new Map();
    this._dataChannelCleanups = new Map();
    this._cleanups = [];
    this._listenerMap = new Map();
    this._memberIds = [];
    this._memberPresence = [];
    this._presenceSeen = false;
    this._presenceWaiters = new Set();
    this._state = 'watching';
    this._joinPromise = null;
    this._leavePromise = null;
    this._joinStarted = false;
    this._joined = false;
    this._presenceHeartbeatTimer = null;
    this._hadRemoteMembers = false;

    // Map each on<Event> option to its event name. Iterated below to register
    // handlers; add new events here rather than as another `if` branch.
    // Note: onStateChange maps to the lowercase 'statechange' event, and the
    // peer* names are deprecated aliases retained for backwards compatibility.
    const handlers = [
      ['memberStream', onMemberStream],
      ['memberTrack', onMemberTrack],
      ['memberJoined', onMemberJoined],
      ['memberLeft', onMemberLeft],
      ['memberStreamRemoved', onMemberStreamRemoved],
      ['alone', onAlone],
      ['membersChanged', onMembersChanged],
      ['statechange', onStateChange],
      ['peerStream', onPeerStream],
      ['peerTrack', onPeerTrack],
      ['peerJoined', onPeerJoined],
      ['peerLeft', onPeerLeft],
      ['full', onFull],
      ['localStream', onLocalStream],
      ['dataChannel', onDataChannel],
      ['dataChannelOpen', onDataChannelOpen],
      ['dataChannelMessage', onDataChannelMessage],
      ['dataChannelClose', onDataChannelClose],
      ['error', onError],
    ];
    for (const [event, handler] of handlers) {
      if (handler) this._cleanups.push(this.on(event, handler));
    }

    this.ready = this._start();
  }

  get members() {
    return [...this._memberIds];
  }

  get memberPresence() {
    return this._memberPresence.map(clonePresenceMember);
  }

  get memberCount() {
    return this._memberIds.length;
  }

  get remoteMemberStreams() {
    const streams = [];
    const seen = new Set();
    const addStream = (memberId) => {
      if (seen.has(memberId)) return;
      const stream = this.remoteStreams.get(memberId);
      if (!stream) return;
      const previous = this._remoteMemberStreamEntries.get(memberId);
      const entry =
        previous?.stream === stream ? previous : { memberId, stream };
      this._remoteMemberStreamEntries.set(memberId, entry);
      streams.push(entry);
      seen.add(memberId);
    };

    for (const memberId of this._memberIds) {
      addStream(memberId);
    }

    for (const memberId of this.remoteStreams.keys()) {
      if (!seen.has(memberId)) addStream(memberId);
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
    for (const cleanup of this._cleanups.splice(0)) cleanup();
    this._closeAllPeers({ emitLeft: false });
    this._hadRemoteMembers = false;

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

  join(data) {
    if (this._state === 'closed') {
      return Promise.reject(new Error('P2PRoom.join: room is closed'));
    }
    if (data !== undefined) {
      assertPresenceData(data, 'P2PRoom.join');
      this._presenceData = data;
    }
    if (this._state === 'active') {
      return data === undefined ? Promise.resolve() : this.setPresenceData(data);
    }
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

  async setPresenceData(data) {
    assertPresenceData(data, 'P2PRoom.setPresenceData');
    this._presenceData = data;
    if (this._state === 'closed') {
      throw new Error('P2PRoom.setPresenceData: room is closed');
    }
    if (!this._joined) return;

    const signaling = await this._ensureSignaling();
    if (typeof signaling.updatePresenceData === 'function') {
      await Promise.resolve(signaling.updatePresenceData(this.peerId, data));
      return;
    }
    if (typeof signaling.refreshPresence === 'function') {
      await Promise.resolve(signaling.refreshPresence(this.peerId, data));
      return;
    }
    throw new Error(
      'P2PRoom.setPresenceData: signaling does not support presence data updates',
    );
  }

  /**
   * Replace one reserved local publication slot on every active room pair.
   * The room commits the desired track even if individual pairs fail, so the
   * same call can be retried and members joining later receive the new track.
   */
  async setLocalTrack(slotId, track) {
    if (this._state === 'closed') {
      throw new Error('P2PRoom.setLocalTrack: room is closed');
    }
    const slot = this._localTrackSlots.get(slotId);
    if (!slot) {
      throw new Error(`P2PRoom.setLocalTrack: unknown slot "${slotId}"`);
    }
    const nextTrack = track ?? null;
    assertLocalTrackKind(slotId, slot.kind, nextTrack, 'P2PRoom.setLocalTrack');

    const previousTrack = slot.track;
    slot.track = nextTrack;
    this._localTrackSlotVersion += 1;
    this._syncSlotTrackToLocalStream(previousTrack, nextTrack);

    const pairs = [...this.pairs];
    const results = await Promise.allSettled(
      pairs.map(async ([memberId, pair]) => {
        await pair.setLocalTrack(slotId, nextTrack);
        return memberId;
      }),
    );
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [{ memberId: pairs[index][0], error: result.reason }]
        : [],
    );
    if (failures.length > 0) {
      throw new LocalTrackReplacementError(slotId, failures);
    }
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
    const cleanup = this.signaling.onPeers((snapshot) => {
      const { members: memberPresence, explicitlyLeft } =
        normalizePresenceSnapshot(snapshot);
      const memberIds = memberPresence.map((member) => member.memberId);
      const previousRemoteMemberIds = this._memberIds.filter(
        (memberId) => memberId !== this.peerId,
      );
      const nextMemberIds = new Set(memberIds);
      const departureReasons = new Map(
        previousRemoteMemberIds
          .filter((memberId) => !nextMemberIds.has(memberId))
          .map((memberId) => [
            memberId,
            explicitlyLeft.has(memberId) ? 'left' : 'dropped',
          ]),
      );
      if (!this._presenceSeen) {
        this._presenceSeen = true;
        for (const waiter of this._presenceWaiters) waiter();
        this._presenceWaiters.clear();
      }
      this._setMembers(memberPresence);
      if (
        (this._state === 'watching' || this._state === 'joining') &&
        this._isFull(memberIds)
      ) {
        this._emitFull(memberIds);
      }
      this._syncMembers(memberIds, departureReasons);
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
    // Capacity is evaluated against backend presence. Adapters must emit an
    // initial onPeers snapshot to watchers; if it hasn't arrived yet, wait
    // briefly rather than joining blind against an empty member list. Only
    // yield when the wait can matter — unlimited rooms and rooms with a
    // snapshot keep the synchronous join path.
    if (!this._presenceSeen && Number.isFinite(this.memberCapacity)) {
      await this._awaitPresenceSnapshot();
      if (this._state === 'closed') {
        throw new Error('P2PRoom.join: room is closed');
      }
      if (this.signal?.aborted) throw createAbortError();
    }
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
      await Promise.resolve(signaling.join(this.peerId, this._presenceData));
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
    this._syncMembers(this._memberIds);
  }

  async _leave() {
    this._setState('leaving');
    const shouldLeave = this._joined || this._joinStarted;
    try {
      if (shouldLeave) {
        const signaling = await this._ensureSignaling();
        await Promise.resolve(signaling.leave(this.peerId));
      }
    } finally {
      this._closeAllPeers({ emitLeft: true });
      this._hadRemoteMembers = false;
      if (shouldLeave) {
        this._joinStarted = false;
        this._joined = false;
      }
      this._stopPresenceHeartbeat();
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
        .then(() => signaling.refreshPresence(this.peerId, this._presenceData))
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

  async _leaveAfterJoin() {
    this._setState('leaving');
    await this._joinPromise.catch(() => {});
    if (this._state !== 'closed') await this._leave();
  }

  _syncMembers(memberIds, departureReasons = new Map()) {
    if (this._state !== 'active') return;
    const allowedMemberIds = this._allowedMemberIds(memberIds);
    const remoteMemberIds = new Set(
      allowedMemberIds.filter((id) => id !== this.peerId),
    );
    for (const memberId of remoteMemberIds) this._connectMember(memberId);
    const managedMemberIds = new Set([
      ...this.pairs.keys(),
      ...this._controllers.keys(),
    ]);
    for (const memberId of managedMemberIds) {
      if (!remoteMemberIds.has(memberId)) {
        this._closeMember(memberId, {
          reason: departureReasons.get(memberId) ?? 'dropped',
        });
      }
    }
    this._updateAloneState(remoteMemberIds.size, departureReasons);
  }

  _updateAloneState(remoteCount, departureReasons) {
    if (remoteCount > 0) {
      this._hadRemoteMembers = true;
      return;
    }
    // Only fire on the transition from having remote members to none, so
    // joining an empty room does not immediately emit `alone` / auto-close.
    if (!this._hadRemoteMembers) return;
    this._hadRemoteMembers = false;
    const reasons = [...departureReasons.values()];
    const reason =
      reasons.length > 0 && reasons.every((value) => value === 'left')
        ? 'left'
        : 'dropped';
    this._emitAlone(reason);
    if (this.autoCloseWhenAlone) {
      Promise.resolve(this.close()).catch(() => {});
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
    const initialLocalTrackSlotVersion = this._localTrackSlotVersion;

    this._controllers.set(remoteMemberId, controller);
    this._pairSignalings.set(remoteMemberId, pairSignaling);
    this._emitMemberJoined(remoteMemberId);

    createSession({
      signaling: pairSignaling,
      localStream: this.localStream,
      localTrackSlots: this._snapshotLocalTrackSlots(),
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
      .then(async (pair) => {
        if (this._state !== 'active' || controller.signal.aborted) {
          pair.close();
          pairSignaling.close?.();
          return;
        }
        try {
          let appliedVersion = initialLocalTrackSlotVersion;
          while (appliedVersion !== this._localTrackSlotVersion) {
            const targetVersion = this._localTrackSlotVersion;
            for (const slot of this._localTrackSlots.values()) {
              await pair.setLocalTrack(slot.id, slot.track);
            }
            appliedVersion = targetVersion;
          }
        } catch (error) {
          pair.close();
          pairSignaling.close?.();
          throw error;
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
        Promise.resolve(signaling.close?.()).catch(() => {});
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
          if (!stream && this._localTrackSlots.size === 0) return null;
          stream ??= new MediaStream();
          if (this._state === 'closed' || this.signal?.aborted) {
            stopStream(stream);
            throw createAbortError();
          }
          this.localStream = stream;
          this._ownsLocalStream = true;
          this._ownedLocalTracks = new Set(stream.getTracks());
          this._syncAllSlotTracksToLocalStream();
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

    const tracksToStop = new Set([
      ...this.localStream.getTracks(),
      ...this._ownedLocalTracks,
    ]);
    for (const slot of this._localTrackSlots.values()) {
      if (this._ownedLocalTracks.has(slot.track)) {
        slot.track = null;
      } else if (slot.track) {
        tracksToStop.delete(slot.track);
      }
    }
    for (const track of tracksToStop) track.stop();
    this._ownedLocalTracks.clear();
    this.localStream = null;
    this._ownsLocalStream = false;
  }

  _snapshotLocalTrackSlots() {
    return [...this._localTrackSlots.values()].map((slot) => ({ ...slot }));
  }

  _syncAllSlotTracksToLocalStream() {
    if (!this.localStream) return;
    const currentTracks = new Set(this.localStream.getTracks());
    for (const { track } of this._localTrackSlots.values()) {
      if (track && !currentTracks.has(track)) {
        this.localStream.addTrack(track);
        currentTracks.add(track);
      }
    }
  }

  _syncSlotTrackToLocalStream(previousTrack, nextTrack) {
    if (!this.localStream) return;
    const tracks = new Set(this.localStream.getTracks());
    const previousStillUsed = [...this._localTrackSlots.values()].some(
      (slot) => slot.track === previousTrack,
    );
    let changed = false;
    if (previousTrack && !previousStillUsed && tracks.has(previousTrack)) {
      this.localStream.removeTrack(previousTrack);
      changed = true;
    }
    if (nextTrack && !tracks.has(nextTrack)) {
      this.localStream.addTrack(nextTrack);
      changed = true;
    }
    if (changed) this._emit('localStream', { stream: this.localStream });
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

  _closeMember(memberId, { emitLeft = true, reason = 'dropped' } = {}) {
    this._controllers.get(memberId)?.abort();
    this._controllers.delete(memberId);
    this.pairs.get(memberId)?.close();
    this.pairs.delete(memberId);
    this._pairSignalings.get(memberId)?.close?.();
    this._pairSignalings.delete(memberId);
    this._closeDataChannel(memberId);
    const stream = this.remoteStreams.get(memberId) ?? null;
    this.remoteStreams.delete(memberId);
    this._remoteMemberStreamEntries.delete(memberId);
    if (stream) this._emitMemberStreamRemoved(memberId, stream);
    if (emitLeft) this._emitMemberLeft(memberId, stream, reason);
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
    const onClose = () => {
      this._closeDataChannel(memberId);
      this._emit('dataChannelClose', { peerId: memberId, memberId, channel });
    };

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

  /**
   * Resolve once the first onPeers snapshot has been received, or after a
   * short timeout for adapters that violate the snapshot contract (degrades
   * to the previous join-blind behavior instead of blocking forever).
   */
  _awaitPresenceSnapshot(timeoutMs = 2000) {
    if (this._presenceSeen) return Promise.resolve();
    return new Promise((resolve) => {
      const waiter = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this._presenceWaiters.delete(waiter);
        resolve();
      }, timeoutMs);
      this._presenceWaiters.add(waiter);
    });
  }

  _setMembers(memberPresence) {
    const nextPresence = memberPresence.map(clonePresenceMember);
    if (areSamePresenceMembers(this._memberPresence, nextPresence)) return;
    this._memberPresence = nextPresence;
    this._memberIds = nextPresence.map((member) => member.memberId);
    this._emitMembersChanged();
  }

  _emitMembersChanged() {
    this._emit('membersChanged', {
      members: this.members,
      memberPresence: this.memberPresence,
      memberCount: this.memberCount,
      memberCapacity: this.memberCapacity,
    });
  }

  _emitMemberJoined(memberId) {
    this._emit('memberJoined', { memberId });
    this._emit('peerJoined', { peerId: memberId, memberId });
  }

  _emitMemberLeft(memberId, stream, reason) {
    log(`[Room] Member "${memberId}" left (${reason})`);
    this._emit('memberLeft', { memberId, stream, reason });
    this._emit('peerLeft', { peerId: memberId, memberId, stream, reason });
  }

  _emitMemberStream(detail) {
    this._emit('memberStream', detail);
    this._emit('peerStream', { ...detail, peerId: detail.memberId });
  }

  _emitMemberStreamRemoved(memberId, stream) {
    this._emit('memberStreamRemoved', { memberId, stream });
    this._emit('peerStreamRemoved', { peerId: memberId, memberId, stream });
  }

  _emitAlone(reason) {
    this._emit('alone', {
      members: this.members,
      memberCount: this.memberCount,
      reason,
    });
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

export class LocalTrackReplacementError extends AggregateError {
  constructor(slotId, failures) {
    super(
      failures.map(({ error }) => error),
      `P2PRoom.setLocalTrack: failed for slot "${slotId}" on member(s): ${failures
        .map(({ memberId }) => memberId)
        .join(', ')}`,
    );
    this.name = 'LocalTrackReplacementError';
    this.slotId = slotId;
    this.failures = failures;
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

function areSamePresenceMembers(a, b) {
  if (a.length !== b.length) return false;
  return a.every((member, index) => {
    const next = b[index];
    if (member.memberId !== next.memberId) return false;
    return presenceDataKey(member.data) === presenceDataKey(next.data);
  });
}

function toPublicState(state) {
  return state === 'active' ? 'joined' : state;
}

function normalizePresenceSnapshot(snapshot) {
  const peers = Array.isArray(snapshot?.members) ? snapshot.members : [];
  const explicitlyLeft = new Set(
    Array.isArray(snapshot?.departed)
      ? snapshot.departed
          .filter(
            (departure) =>
              departure?.reason === 'left' &&
              typeof departure.memberId === 'string',
          )
          .map((departure) => departure.memberId)
      : [],
  );
  const byMemberId = new Map();
  const duplicates = new Set();

  for (const entry of peers) {
    const member = normalizePresenceEntry(entry);
    if (!member) continue;
    if (byMemberId.has(member.memberId)) duplicates.add(member.memberId);
    byMemberId.set(member.memberId, member);
  }

  if (duplicates.size > 0) {
    log(
      `[Room] Duplicate memberId(s) in presence snapshot ignored: ${[
        ...duplicates,
      ].join(', ')}`,
    );
  }

  return { members: [...byMemberId.values()], explicitlyLeft };
}

function normalizePresenceEntry(entry) {
  if (typeof entry === 'string') return { memberId: entry };
  if (!entry || typeof entry !== 'object') return null;
  const memberId = typeof entry.memberId === 'string' ? entry.memberId : null;
  if (!memberId) return null;
  if (entry.data === undefined) return { memberId };
  if (!isPresenceData(entry.data)) return { memberId };
  return { memberId, data: entry.data };
}

function clonePresenceMember(member) {
  return member.data === undefined
    ? { memberId: member.memberId }
    : { memberId: member.memberId, data: structuredClone(member.data) };
}

function assertPresenceData(data, methodName) {
  if (isPresenceData(data)) return;
  throw new TypeError(`${methodName}: presence data must be an object`);
}

function isPresenceData(data) {
  return data != null && typeof data === 'object' && !Array.isArray(data);
}

function presenceDataKey(data) {
  if (data === undefined) return undefined;
  try {
    return JSON.stringify(data);
  } catch (_) {
    return data;
  }
}
