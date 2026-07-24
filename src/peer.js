// src/peer.js
//
// High-level Peer abstraction over RTCPeerConnection. Wraps the sdp/ice/
// tracks primitives with a single cohesive lifecycle and an EventTarget-
// based event surface.
//
// Signaling-agnostic: callers inject an RtcSignalingSource implementation
// (see signaling.js). Works for both initiator and joiner roles
// and optionally carries a data channel alongside media tracks.

import { rtcConfig as defaultRtcConfig } from './config.js';
import { createOffer, createAnswer, setRemoteDescription } from './sdp.js';
import { setupIceCandidates, drainIceCandidateQueue } from './ice.js';
import { addLocalTracks } from './tracks.js';
import {
  assertLocalTrackKind,
  normalizeLocalTrackSlots,
} from './local-track-slots.js';
import { log } from './logger.js';
import { createIceServersManager } from './ice-servers.js';

/** @typedef {import('./signaling.js').RtcSignalingSource} RtcSignalingSource */

const PEER_STATES = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  FAILED: 'failed',
  CLOSED: 'closed',
});
const START_CLOSED_ERROR = 'Peer: closed before start completed';
const RECOVERY_CANCELLED = Symbol('ice recovery cancelled');
const ICE_RECOVERY_DEFAULTS = Object.freeze({
  maxAttempts: 3,
  disconnectedGraceMs: 3000,
  attemptTimeoutMs: 10000,
  initialBackoffMs: 1000,
  backoffFactor: 2,
  maxBackoffMs: 8000,
});

/**
 * Events dispatched on Peer (via EventTarget):
 *   - 'statechange'   → detail: { state: PeerState, previous: PeerState }
 *   - 'connected'     → fired once when pc.connectionState becomes 'connected'
 *   - 'disconnected'  → fired when connection drops ('disconnected' | 'failed')
 *   - 'iceReconnecting' → detail: { attempt, maxAttempts, reason, nextDelayMs }
 *   - 'iceReconnected' → detail: { attempt, durationMs }
 *   - 'iceReconnectFailed' → detail: { attempts, reason, error }
 *   - 'track'         → detail: { track, streams } (native RTCTrackEvent fields)
 *   - 'datachannel'   → detail: { channel } (initiator: on create; joiner: on ondatachannel)
 *   - 'open'          → data channel opened
 *   - 'message'       → detail: { data } (data channel message)
 *   - 'close'         → data channel closed
 *   - 'error'         → detail: { error, phase }
 *
 * Sugar `on/off/once` methods exist alongside the standard
 * `addEventListener/removeEventListener` API.
 */
export class Peer extends EventTarget {
  /**
   * @param {Object} options
   * @param {'initiator'|'joiner'} options.role
   * @param {RtcSignalingSource} options.signaling
   * @param {MediaStream}  [options.localStream]
   * @param {Array<{id:string, kind:'audio'|'video', track?:MediaStreamTrack|null}>} [options.localTrackSlots]
   * @param {boolean}      [options.audioOnly=false]
   * @param {boolean}      [options.dataChannel=false]
   *   Initiator: create a data channel up-front. Joiner: forward the remote
   *   channel when it arrives.
   * @param {string}       [options.dataChannelLabel='data']
   * @param {RTCConfiguration} [options.rtcConfig]
   * @param {false|Object} [options.iceRecovery=false]
   * @param {Function} [options.iceServersProvider]
   * @param {number} [options.iceServersRefreshMarginMs]
   */
  constructor(options) {
    super();
    const {
      role,
      signaling,
      localStream = null,
      localTrackSlots = [],
      audioOnly = false,
      dataChannel = false,
      dataChannelLabel = 'data',
      rtcConfig = defaultRtcConfig,
      iceRecovery = false,
      iceServersProvider,
      iceServersRefreshMarginMs,
      _iceServersManager,
    } = options ?? {};

    if (role !== 'initiator' && role !== 'joiner') {
      throw new Error(`Peer: invalid role "${role}"`);
    }
    assertSignaling(signaling);

    this._role = role;
    this._signaling = signaling;
    this._localStream = localStream;
    this._localTrackSlots = new Map(
      normalizeLocalTrackSlots(localTrackSlots, 'Peer').map((slot) => [
        slot.id,
        slot,
      ]),
    );
    this._localTrackSenders = new Map();
    this._audioOnly = audioOnly;
    this._wantsDataChannel = dataChannel;
    this._dataChannelLabel = dataChannelLabel;
    const recoveryOptions = normalizeIceRecoveryOptions(iceRecovery);
    this._ownsIceServersManager = !_iceServersManager;
    this._iceServersManager =
      _iceServersManager ??
      createIceServersManager({
        rtcConfig,
        provider: iceServersProvider,
        refreshMarginMs: iceServersRefreshMarginMs,
        onError: (error) =>
          this._emit('error', { error, phase: 'ice-servers-refresh' }),
      });
    this._startingIceServers = false;

    this._pc = null;
    this._dataChannel = null;
    this._state = PEER_STATES.IDLE;
    this._started = false;
    this._startPromise = null;
    this._closed = false;
    this._pendingStartReject = null;
    this._listenerMap = new Map();
    this._signalingCleanups = new Set();
    this._remoteTrackInfo = new WeakMap();
    this._offerChain = Promise.resolve();
    this._initialOfferApplied = false;
    this._connectedEmitted = false;
    this._handledRestartRequestIds = new Set();
    this._iceRecovery = {
      options: recoveryOptions,
      initiallyConnected: false,
      episodeStartedAt: 0,
      attempt: 0,
      reason: null,
      graceTimer: null,
      backoffTimer: null,
      attemptTimer: null,
      waitResolve: null,
      waitReject: null,
      answerApplied: false,
      iceConnected: false,
      running: false,
      exhausted: false,
      reportedError: null,
    };
  }

  // ─── Public API ───────────────────────────────────────────────────────

  get role() {
    return this._role;
  }
  get state() {
    return this._state;
  }
  get pc() {
    return this._pc;
  }
  get dataChannel() {
    return this._dataChannel;
  }

  /**
   * Kick off the connection. Idempotent: repeat calls return the same promise.
   * Resolves after SDP + local signaling complete (peers may still be
   * negotiating ICE; listen for 'connected' to know when media is flowing).
   *
   * @param {Object} [options]
   * @param {number} [options.startTimeoutMs=0]
   *   Reject if SDP startup does not complete within this many ms. `0`
   *   disables the timeout.
   * @param {number} [options.connectedTimeoutMs=0]
   *   When set, wait for the peer connection to reach `connected` before
   *   resolving, and reject if it does not happen within this many ms.
   * @param {AbortSignal} [options.signal]
   */
  start(options = {}) {
    if (this._state === PEER_STATES.CLOSED) return Promise.resolve();
    if (this._started) return this._startPromise;
    this._started = true;

    const {
      startTimeoutMs = 0,
      connectedTimeoutMs = 0,
      signal = null,
    } = options ?? {};

    this._startPromise = new Promise((resolve, reject) => {
      this._pendingStartReject = reject;
      const rejectStart = reject;
      let settled = false;
      let startTimer = null;
      let abortCleanup = () => {};

      const cleanupStartGuards = () => {
        if (startTimer) {
          clearTimeout(startTimer);
          startTimer = null;
        }
        abortCleanup();
        abortCleanup = () => {};
      };

      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanupStartGuards();
        if (this._pendingStartReject === rejectStart) {
          this._pendingStartReject = null;
        }
        fn(value);
      };
      const failAndClose = (error) => {
        if (settled) return;
        cleanupStartGuards();
        if (this._pendingStartReject === rejectStart) {
          this._pendingStartReject = null;
        }
        this.dispose();
        settled = true;
        reject(error);
      };

      if (signal) {
        if (signal.aborted) {
          failAndClose(createAbortError());
          return;
        }
        const abortHandler = () => failAndClose(createAbortError());
        signal.addEventListener('abort', abortHandler, { once: true });
        abortCleanup = () => {
          signal.removeEventListener('abort', abortHandler);
        };
      }

      if (startTimeoutMs > 0) {
        startTimer = setTimeout(() => {
          failAndClose(
            new Error(`Peer.start: timed out after ${startTimeoutMs}ms`),
          );
        }, startTimeoutMs);
      }

      (async () => {
        this._setState(PEER_STATES.CONNECTING);
        this._throwIfClosedDuringStart();
        if (this._iceServersManager.hasProvider) {
          this._startingIceServers = true;
          await this._iceServersManager.ensureFresh('initial');
          this._startingIceServers = false;
          this._throwIfClosedDuringStart();
        }
        if (this._role === 'initiator') {
          await this._startInitiator();
        } else {
          await this._startJoiner();
        }
        if (startTimer) {
          clearTimeout(startTimer);
          startTimer = null;
        }
        if (connectedTimeoutMs > 0) {
          try {
            await this._waitForConnected(connectedTimeoutMs);
          } catch (error) {
            this._closeWithoutRejectingStart();
            throw error;
          }
        }
      })().then(
        (value) => settle(resolve, value),
        (error) => settle(reject, error),
      );
    });

    // Don't leak rejections — caller can still await start() to see them.
    this._startPromise.catch((error) => {
      this._emit('error', {
        error,
        phase: this._startingIceServers ? 'ice-servers-initial' : 'start',
      });
      if (this._state !== PEER_STATES.CLOSED) {
        this._cleanupSignaling();
        this._setState(PEER_STATES.FAILED);
      }
    });

    return this._startPromise;
  }

  /**
   * Send data through the data channel. Throws if no channel or not open.
   * @param {string|Blob|ArrayBuffer|ArrayBufferView} data
   */
  send(data) {
    if (!this._dataChannel) {
      throw new Error('Peer.send: no data channel');
    }
    if (this._dataChannel.readyState !== 'open') {
      throw new Error(
        `Peer.send: data channel not open (state=${this._dataChannel.readyState})`,
      );
    }
    this._dataChannel.send(data);
  }

  /** Replace a reserved local publication slot without renegotiation. */
  async setLocalTrack(slotId, track) {
    const slot = this._localTrackSlots.get(slotId);
    if (!slot) {
      throw new Error(`Peer.setLocalTrack: unknown slot "${slotId}"`);
    }
    const nextTrack = track ?? null;
    assertLocalTrackKind(slotId, slot.kind, nextTrack, 'Peer.setLocalTrack');

    const sender = this._localTrackSenders.get(slotId);
    if (sender) await sender.replaceTrack(nextTrack);
    slot.track = nextTrack;
  }

  /**
   * Permanently dispose of the peer connection and associated data channel.
   * Safe to call multiple times.
   */
  dispose() {
    if (this._closed) return;
    this._closed = true;

    this._cancelIceRecovery();
    this._cleanupSignaling();
    this._iceServersManager.removePeerConnection(this._pc);
    if (this._ownsIceServersManager) this._iceServersManager.dispose();

    try {
      this._dataChannel?.close();
    } catch (_) {}

    try {
      this._pc?.close();
    } catch (err) {
      log('[Peer] Error closing peer connection:', err);
    }

    this._setState(PEER_STATES.CLOSED);

    if (this._pendingStartReject) {
      const reject = this._pendingStartReject;
      this._pendingStartReject = null;
      reject(new Error(START_CLOSED_ERROR));
    }
  }

  // ─── on/off/once sugar (thin wrappers over EventTarget) ───────────────

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   * @param {string} type
   * @param {(detail: any, event: CustomEvent) => void} callback
   */
  on(type, callback) {
    const handler = (event) => callback(event.detail, event);
    if (!this._listenerMap.has(type)) {
      this._listenerMap.set(type, new Map());
    }
    const callbacks = this._listenerMap.get(type);
    if (!callbacks.has(callback)) {
      callbacks.set(callback, new Set());
    }
    callbacks.get(callback).add(handler);
    this.addEventListener(type, handler);
    return () => {
      this.removeEventListener(type, handler);
      const handlers = this._listenerMap.get(type)?.get(callback);
      handlers?.delete(handler);
      if (handlers?.size === 0) {
        this._listenerMap.get(type)?.delete(callback);
      }
    };
  }

  /**
   * Subscribe once; auto-unsubscribes after first fire.
   * @param {string} type
   * @param {(detail: any, event: CustomEvent) => void} callback
   */
  once(type, callback) {
    if (!this._listenerMap.has(type)) {
      this._listenerMap.set(type, new Map());
    }
    const callbacks = this._listenerMap.get(type);
    if (!callbacks.has(callback)) {
      callbacks.set(callback, new Set());
    }
    const handlers = callbacks.get(callback);

    const forget = () => {
      handlers.delete(handler);
      if (handlers.size === 0) callbacks.delete(callback);
    };
    const handler = (event) => {
      this.removeEventListener(type, handler);
      forget();
      callback(event.detail, event);
    };
    handlers.add(handler);
    this.addEventListener(type, handler);

    return () => {
      this.removeEventListener(type, handler);
      forget();
    };
  }

  /**
   * Remove a previously-registered listener. Callers using `on`/`once` should
   * prefer the returned unsubscribe function; this is here for parity with
   * other emitter APIs.
   * @param {string} type
   * @param {Function} callback
   */
  off(type, callback) {
    const handlers = this._listenerMap.get(type)?.get(callback);
    if (handlers) {
      for (const handler of handlers) {
        this.removeEventListener(type, handler);
      }
      this._listenerMap.get(type)?.delete(callback);
      return;
    }
    this.removeEventListener(type, callback);
  }

  // ─── Private: role-specific flows ─────────────────────────────────────

  async _startInitiator() {
    this._initPc();
    this._throwIfClosedDuringStart();

    if (this._wantsDataChannel) {
      const channel = this._pc.createDataChannel(this._dataChannelLabel);
      this._bindDataChannel(channel);
    }
    this._throwIfClosedDuringStart();

    this._rememberSignalingCleanup(
      this._signaling.onAnswer(async (answer) => {
        if (!answer || this._closed) return;
        try {
          const applied = await setRemoteDescription(
            this._pc,
            answer,
            drainIceCandidateQueue,
          );
          if (!applied) return;
          this._emitReceiverTracks();
          if (this._iceRecovery.running) {
            this._iceRecovery.answerApplied = true;
            this._iceRecovery.iceConnected = isIceConnected(this._pc);
            this._resolveRecoveryAttemptIfReady();
          }
          log('[Peer] Remote answer applied');
        } catch (err) {
          const phase = this._iceRecovery.running ? 'ice-restart' : 'answer';
          this._emit('error', { error: err, phase });
          if (this._iceRecovery.running) {
            this._iceRecovery.reportedError = err;
          }
          this._rejectRecoveryWait(err);
        }
      }),
    );
    this._subscribeToIceRestartRequests();

    const offer = await createOffer(this._pc);
    this._throwIfClosedDuringStart();
    await this._signaling.sendOffer({ type: offer.type, sdp: offer.sdp });
    this._throwIfClosedDuringStart();
    log('[Peer] Offer sent (initiator)');
  }

  async _startJoiner() {
    this._initPc();

    this._throwIfClosedDuringStart();

    await new Promise((resolve, reject) => {
      let initialSettled = false;
      this._rememberSignalingCleanup(
        this._signaling.onOffer((offer) => {
          this._offerChain = this._offerChain
            .then(() => this._handleOffer(offer))
            .then((applied) => {
              if (!applied || initialSettled) return;
              initialSettled = true;
              resolve();
            })
            .catch((err) => {
              const recovering = this._iceRecovery.running;
              this._emit('error', {
                error: err,
                phase: recovering ? 'ice-restart' : 'offer',
              });
              if (recovering) this._iceRecovery.reportedError = err;
              this._rejectRecoveryWait(err);
              if (!initialSettled) {
                initialSettled = true;
                reject(err);
              }
            });
        }),
      );
    });
  }

  async _handleOffer(offer) {
    if (!offer || this._closed || this._pc.signalingState !== 'stable') {
      return false;
    }
    const applied = await setRemoteDescription(
      this._pc,
      offer,
      drainIceCandidateQueue,
    );
    if (!applied || this._closed) return false;
    this._emitReceiverTracks();

    if (!this._initialOfferApplied) {
      await this._setupJoinerTrackSlots();
      if (this._closed) return false;
      this._initialOfferApplied = true;
    }

    const answer = await createAnswer(this._pc);
    if (this._closed) return false;
    await this._signaling.sendAnswer({
      type: answer.type,
      sdp: answer.sdp,
    });
    if (this._closed) return false;
    if (this._iceRecovery.running) {
      this._iceRecovery.answerApplied = true;
      this._iceRecovery.iceConnected = isIceConnected(this._pc);
      this._resolveRecoveryAttemptIfReady();
    }
    log('[Peer] Answer sent (joiner)');
    return true;
  }

  async _setupJoinerTrackSlots() {
    if (this._localTrackSlots.size === 0) return;
    const transceivers = this._pc.getTransceivers();
    let index = 0;
    for (const slot of this._localTrackSlots.values()) {
      const transceiver = transceivers[index++];
      if (transceiver?.receiver.track.kind !== slot.kind) {
        throw new Error(
          `Peer: local track slot "${slot.id}" has no matching remote ${slot.kind} transceiver`,
        );
      }
      transceiver.direction = 'sendrecv';
      if (this._localStream) transceiver.sender.setStreams(this._localStream);
      await transceiver.sender.replaceTrack(slot.track);
      this._localTrackSenders.set(slot.id, transceiver.sender);
    }
  }

  _throwIfClosedDuringStart() {
    if (this._closed || this._state === PEER_STATES.CLOSED) {
      throw new Error(START_CLOSED_ERROR);
    }
  }

  // ─── Private: PC setup + event wiring ─────────────────────────────────

  _initPc() {
    const pc = new RTCPeerConnection(this._iceServersManager.getRtcConfig());
    this._pc = pc;
    this._iceServersManager.addPeerConnection(pc);

    if (this._localTrackSlots.size > 0) {
      if (this._role === 'initiator') {
        for (const slot of this._localTrackSlots.values()) {
          const init = { direction: 'sendrecv' };
          if (this._localStream) init.streams = [this._localStream];
          const transceiver = pc.addTransceiver(slot.track ?? slot.kind, init);
          this._localTrackSenders.set(slot.id, transceiver.sender);
        }
      }
    } else if (this._localStream) {
      const health = addLocalTracks(pc, this._localStream, {
        audioOnly: this._audioOnly,
      });
      if (!health.allHealthy) {
        this._emit('error', {
          error: new Error(
            `Unhealthy local tracks: ${health.unhealthyKinds.join(', ')}`,
          ),
          phase: 'tracks',
        });
      }
    }

    this._rememberSignalingCleanup(setupIceCandidates(pc, this._signaling));

    pc.addEventListener('track', (event) => {
      log('[Peer] Track event:', {
        track: event.track,
        streams: event.streams,
      });
      this._emitRemoteTrack(event.track, event.streams, 'native');
    });

    pc.addEventListener('connectionstatechange', () => {
      const connState = pc.connectionState;
      log(`[Peer] connectionState → ${connState}`);
      if (connState === 'connected') {
        this._emitReceiverTracks();
        this._setState(PEER_STATES.CONNECTED);
        this._iceRecovery.initiallyConnected = true;
        if (!this._connectedEmitted) {
          this._connectedEmitted = true;
          this._emit('connected', {});
        }
      } else if (connState === 'disconnected') {
        this._setState(PEER_STATES.DISCONNECTED);
        this._emit('disconnected', {
          reason: 'disconnected',
          iceRecoveryScheduled: this._willScheduleIceRecovery(),
        });
      } else if (connState === 'failed') {
        this._setState(PEER_STATES.FAILED);
        this._emit('disconnected', {
          reason: 'failed',
          iceRecoveryScheduled: this._willScheduleIceRecovery(),
        });
      } else if (connState === 'closed') {
        this._setState(PEER_STATES.CLOSED);
      }
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      this._handleIceConnectionStateChange();
    });

    pc.addEventListener('datachannel', (event) => {
      // Joiner path: remote created the channel.
      if (this._wantsDataChannel || this._role === 'joiner') {
        this._bindDataChannel(event.channel);
      }
    });
  }

  _handleIceConnectionStateChange() {
    if (!this._iceRecovery.options || this._closed) return;
    const iceState = this._pc.iceConnectionState;
    log(`[Peer] iceConnectionState → ${iceState}`);

    if (iceState === 'connected' || iceState === 'completed') {
      this._clearRecoveryTimer('graceTimer');
      if (this._iceRecovery.running) {
        this._iceRecovery.iceConnected = true;
        if (this._iceRecovery.backoffTimer) {
          this._finishIceRecovery();
        } else {
          this._resolveRecoveryAttemptIfReady();
        }
      }
      return;
    }
    if (!this._iceRecovery.initiallyConnected) return;
    if (iceState === 'failed') {
      this._clearRecoveryTimer('graceTimer');
      this._startIceRecovery('failed');
      return;
    }
    if (
      iceState === 'disconnected' &&
      !this._iceRecovery.running &&
      !this._iceRecovery.graceTimer
    ) {
      this._iceRecovery.graceTimer = setTimeout(() => {
        this._iceRecovery.graceTimer = null;
        if (
          !this._closed &&
          this._pc?.iceConnectionState === 'disconnected'
        ) {
          this._startIceRecovery('disconnected');
        }
      }, this._iceRecovery.options.disconnectedGraceMs);
    }
  }

  _willScheduleIceRecovery() {
    if (!this._iceRecovery.options || !this._iceRecovery.initiallyConnected) {
      return false;
    }
    return (
      this._iceRecovery.running ||
      this._pc?.iceConnectionState === 'disconnected' ||
      this._pc?.iceConnectionState === 'failed'
    );
  }

  _subscribeToIceRestartRequests() {
    if (typeof this._signaling.onIceRestartRequest !== 'function') return;
    this._rememberSignalingCleanup(
      this._signaling.onIceRestartRequest((request) => {
        const requestId = request?.requestId;
        if (
          this._closed ||
          this._role !== 'initiator' ||
          typeof requestId !== 'string' ||
          !requestId ||
          this._handledRestartRequestIds.has(requestId)
        ) {
          return;
        }
        this._handledRestartRequestIds.add(requestId);
        if (this._handledRestartRequestIds.size > 32) {
          this._handledRestartRequestIds.delete(
            this._handledRestartRequestIds.values().next().value,
          );
        }
        if (this._iceRecovery.options && this._iceRecovery.initiallyConnected) {
          this._startIceRecovery('remote-request');
        }
      }),
    );
  }

  _startIceRecovery(reason) {
    const recovery = this._iceRecovery;
    if (
      !recovery.options ||
      !recovery.initiallyConnected ||
      recovery.running ||
      this._closed
    ) {
      return;
    }
    recovery.running = true;
    recovery.exhausted = false;
    recovery.episodeStartedAt = Date.now();
    recovery.attempt = 0;
    recovery.reason = reason;
    recovery.answerApplied = false;
    recovery.iceConnected = false;
    recovery.reportedError = null;

    if (
      this._role === 'joiner' &&
      typeof this._signaling.sendIceRestartRequest !== 'function'
    ) {
      const error = new Error(
        'Peer: signaling does not support ICE restart requests',
      );
      this._emit('error', { error, phase: 'ice-restart-request' });
      this._failIceRecovery(error);
      return;
    }
    void this._runIceRecovery();
  }

  async _runIceRecovery() {
    const recovery = this._iceRecovery;
    while (
      recovery.running &&
      recovery.attempt < recovery.options.maxAttempts
    ) {
      const attempt = recovery.attempt + 1;
      const nextDelayMs =
        attempt === 1
          ? 0
          : Math.min(
              recovery.options.initialBackoffMs *
                recovery.options.backoffFactor ** (attempt - 2),
              recovery.options.maxBackoffMs,
            );
      recovery.attempt = attempt;
      this._emit('iceReconnecting', {
        attempt,
        maxAttempts: recovery.options.maxAttempts,
        reason: recovery.reason,
        nextDelayMs,
      });

      try {
        await this._waitForRecoveryBackoff(nextDelayMs);
        if (!recovery.running || this._closed) return;
        recovery.answerApplied = false;
        recovery.iceConnected = false;
        recovery.reportedError = null;
        await this._performIceRecoveryAttempt();
        if (recovery.running) this._finishIceRecovery();
        return;
      } catch (error) {
        if (error === RECOVERY_CANCELLED || !recovery.running || this._closed) {
          return;
        }
        if (recovery.reportedError !== error) {
          this._emit('error', {
            error,
            phase:
              this._role === 'initiator'
                ? 'ice-restart'
                : 'ice-restart-request',
          });
        }
        if (recovery.attempt >= recovery.options.maxAttempts) {
          this._failIceRecovery(error);
          return;
        }
      }
    }
  }

  async _performIceRecoveryAttempt() {
    const wait = this._waitForRecoveryAttempt();
    try {
      if (this._role === 'initiator') {
        await this._iceServersManager.ensureFresh('ice-restart');
        this._pc.restartIce();
        const offer = await createOffer(this._pc);
        if (this._closed || !this._iceRecovery.running) {
          throw RECOVERY_CANCELLED;
        }
        await this._signaling.sendOffer({
          type: offer.type,
          sdp: offer.sdp,
        });
      } else {
        await this._requestIceRestart();
      }
    } catch (error) {
      this._rejectRecoveryWait(error);
    }
    await wait;
  }

  _requestIceRestart() {
    return this._signaling.sendIceRestartRequest({
      requestId: createRequestId(),
    });
  }

  _waitForRecoveryBackoff(delayMs) {
    if (delayMs === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this._iceRecovery.waitReject = reject;
      this._iceRecovery.backoffTimer = setTimeout(() => {
        this._iceRecovery.backoffTimer = null;
        this._iceRecovery.waitReject = null;
        resolve();
      }, delayMs);
    });
  }

  _waitForRecoveryAttempt() {
    return new Promise((resolve, reject) => {
      this._iceRecovery.waitResolve = resolve;
      this._iceRecovery.waitReject = reject;
      this._iceRecovery.attemptTimer = setTimeout(() => {
        this._iceRecovery.attemptTimer = null;
        this._iceRecovery.waitResolve = null;
        this._iceRecovery.waitReject = null;
        reject(
          new Error(
            `Peer: ICE recovery attempt timed out after ${this._iceRecovery.options.attemptTimeoutMs}ms`,
          ),
        );
      }, this._iceRecovery.options.attemptTimeoutMs);
    });
  }

  _resolveRecoveryAttemptIfReady() {
    const recovery = this._iceRecovery;
    if (
      !recovery.running ||
      !recovery.answerApplied ||
      !recovery.iceConnected ||
      !recovery.waitResolve
    ) {
      return;
    }
    const resolve = recovery.waitResolve;
    this._clearRecoveryTimer('attemptTimer');
    recovery.waitResolve = null;
    recovery.waitReject = null;
    resolve();
  }

  _rejectRecoveryWait(error) {
    const reject = this._iceRecovery.waitReject;
    if (!reject) return;
    this._clearRecoveryTimer('attemptTimer');
    this._clearRecoveryTimer('backoffTimer');
    this._iceRecovery.waitResolve = null;
    this._iceRecovery.waitReject = null;
    reject(error);
  }

  _finishIceRecovery() {
    const recovery = this._iceRecovery;
    if (!recovery.running || this._closed) return;
    const detail = {
      attempt: recovery.attempt,
      durationMs: Date.now() - recovery.episodeStartedAt,
    };
    recovery.running = false;
    this._rejectRecoveryWait(RECOVERY_CANCELLED);
    recovery.attempt = 0;
    recovery.reason = null;
    recovery.exhausted = false;
    this._setState(PEER_STATES.CONNECTED);
    this._emit('iceReconnected', detail);
  }

  _failIceRecovery(error) {
    const recovery = this._iceRecovery;
    if (!recovery.running || this._closed) return;
    const detail = {
      attempts: recovery.attempt,
      reason: recovery.reason,
      error,
    };
    recovery.running = false;
    recovery.exhausted = true;
    this._rejectRecoveryWait(RECOVERY_CANCELLED);
    this._setState(PEER_STATES.FAILED);
    this._emit('iceReconnectFailed', detail);
  }

  _cancelIceRecovery() {
    const recovery = this._iceRecovery;
    recovery.running = false;
    this._clearRecoveryTimer('graceTimer');
    this._rejectRecoveryWait(RECOVERY_CANCELLED);
  }

  _clearRecoveryTimer(name) {
    const timer = this._iceRecovery[name];
    if (timer) clearTimeout(timer);
    this._iceRecovery[name] = null;
  }

  _bindDataChannel(channel) {
    this._dataChannel = channel;
    this._emit('datachannel', { channel });

    channel.addEventListener('open', () => {
      this._emit('open', {});
    });
    channel.addEventListener('message', (event) => {
      this._emit('message', { data: event.data });
    });
    channel.addEventListener('close', () => {
      this._emit('close', {});
    });
    channel.addEventListener('error', (event) => {
      this._emit('error', { error: event.error, phase: 'datachannel' });
    });
  }

  _emitReceiverTracks() {
    const receivers =
      typeof this._pc?.getReceivers === 'function'
        ? this._pc.getReceivers()
        : [];
    for (const receiver of receivers) {
      const track = receiver?.track;
      if (track && track.readyState !== 'ended') {
        this._emitRemoteTrack(track, [], 'fallback');
      }
    }
  }

  _emitRemoteTrack(track, streams = [], emittedFrom = 'native') {
    if (!track) return;
    const normalizedStreams = Array.from(streams ?? []);
    const previous = this._remoteTrackInfo.get(track);
    if (
      previous &&
      (previous.emittedFrom === 'native' ||
        sameStreams(previous.streams, normalizedStreams))
    ) {
      return;
    }
    this._remoteTrackInfo.set(track, {
      emittedFrom,
      streams: normalizedStreams,
    });
    this._emit('track', { track, streams: normalizedStreams });
  }

  // ─── Private: emit + state helpers ────────────────────────────────────

  _setState(next) {
    if (this._state === next) return;
    const previous = this._state;
    this._state = next;
    this._emit('statechange', { state: next, previous });
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _rememberSignalingCleanup(cleanup) {
    if (typeof cleanup !== 'function') return;
    let active = true;
    const wrapped = () => {
      if (!active) return;
      active = false;
      this._signalingCleanups.delete(wrapped);
      cleanup();
    };
    this._signalingCleanups.add(wrapped);
  }

  _cleanupSignaling() {
    for (const cleanup of [...this._signalingCleanups]) {
      try {
        cleanup();
      } catch (err) {
        log('[Peer] Error cleaning up signaling listener:', err);
      }
    }
    this._signalingCleanups.clear();
  }

  _closeWithoutRejectingStart() {
    const pendingStartReject = this._pendingStartReject;
    this._pendingStartReject = null;
    this.dispose();
    this._pendingStartReject = pendingStartReject;
  }

  _waitForConnected(timeoutMs) {
    if (this._state === PEER_STATES.CONNECTED) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let timer = null;
      let offState = () => {};
      let offConnected = () => {};

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        offState();
        offConnected();
        offState = () => {};
        offConnected = () => {};
      };
      const fail = (error) => {
        cleanup();
        reject(error);
      };

      offConnected = this.once('connected', () => {
        cleanup();
        resolve();
      });
      offState = this.on('statechange', ({ state }) => {
        if (state === PEER_STATES.FAILED || state === PEER_STATES.CLOSED) {
          fail(new Error(`Peer.start: connection ${state}`));
        }
      });
      timer = setTimeout(() => {
        fail(
          new Error(`Peer.start: connection timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);
    });
  }
}

function sameStreams(left, right) {
  if (left.length !== right.length) return false;
  return left.every((stream, index) => stream === right[index]);
}

function isIceConnected(pc) {
  return (
    pc?.iceConnectionState === 'connected' ||
    pc?.iceConnectionState === 'completed'
  );
}

export { PEER_STATES };

function createAbortError() {
  try {
    return new DOMException('Peer.start: aborted', 'AbortError');
  } catch (_) {
    const error = new Error('Peer.start: aborted');
    error.name = 'AbortError';
    return error;
  }
}

function assertSignaling(signaling) {
  if (!signaling) {
    throw new Error('Peer: signaling channel is required');
  }
  const required = [
    'sendOffer',
    'sendAnswer',
    'onOffer',
    'onAnswer',
    'sendCandidate',
    'onRemoteCandidate',
  ];
  for (const name of required) {
    if (typeof signaling[name] !== 'function') {
      throw new Error(`Peer: signaling channel missing method "${name}"`);
    }
  }
}

function normalizeIceRecoveryOptions(value) {
  if (value == null || value === false) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Peer: iceRecovery must be false or an options object');
  }
  const options = { ...ICE_RECOVERY_DEFAULTS, ...value };
  for (const name of [
    'maxAttempts',
    'disconnectedGraceMs',
    'attemptTimeoutMs',
    'initialBackoffMs',
    'backoffFactor',
    'maxBackoffMs',
  ]) {
    if (typeof options[name] !== 'number' || !Number.isFinite(options[name])) {
      throw new TypeError(`Peer: iceRecovery.${name} must be a finite number`);
    }
  }
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts <= 0) {
    throw new TypeError(
      'Peer: iceRecovery.maxAttempts must be a positive integer',
    );
  }
  for (const name of [
    'disconnectedGraceMs',
    'initialBackoffMs',
    'maxBackoffMs',
  ]) {
    if (options[name] < 0) {
      throw new TypeError(`Peer: iceRecovery.${name} must be non-negative`);
    }
  }
  if (options.attemptTimeoutMs <= 0) {
    throw new TypeError(
      'Peer: iceRecovery.attemptTimeoutMs must be a positive number',
    );
  }
  if (options.backoffFactor < 1) {
    throw new TypeError('Peer: iceRecovery.backoffFactor must be at least 1');
  }
  return Object.freeze(options);
}

function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
