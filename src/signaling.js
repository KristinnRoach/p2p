// src/signaling.js
//
// Signaling contracts and normalized wrappers. The lib is signaling-agnostic
// — consumers implement RtcSignalingSource / P2PRoomSignaling against any
// transport (localStorage, Firebase RTDB, WebSocket, etc.).

/**
 * Minimal interface for exchanging ICE candidates with the remote peer.
 *
 * @typedef {Object} IceTransport
 * @property {(candidate: RTCIceCandidateInit) => void|Promise<void>} sendCandidate
 *   Publish a local ICE candidate to the remote peer.
 * @property {(callback: (candidate: RTCIceCandidateInit) => void) => void|(() => void)} onRemoteCandidate
 *   Subscribe to incoming remote ICE candidates. The callback may be invoked
 *   many times. The transport is responsible for listener lifetime/cleanup.
 */

/**
 * Full 1:1 WebRTC signaling source needed to bring up a PeerConnection.
 * Extends {@link IceTransport} with SDP offer/answer exchange.
 *
 * @typedef {Object} RtcSignalingSource
 * @property {(offer: RTCSessionDescriptionInit) => void|Promise<void>} sendOffer
 * @property {(answer: RTCSessionDescriptionInit) => void|Promise<void>} sendAnswer
 * @property {(callback: (offer: RTCSessionDescriptionInit) => void) => void|(() => void)} onOffer
 * @property {(callback: (answer: RTCSessionDescriptionInit) => void) => void|(() => void)} onAnswer
 * @property {(candidate: RTCIceCandidateInit) => void|Promise<void>} sendCandidate
 * @property {(callback: (candidate: RTCIceCandidateInit) => void) => void|(() => void)} onRemoteCandidate
 * @property {(request: {requestId: string}) => void|Promise<void>} [sendIceRestartRequest]
 * @property {(callback: (request: {requestId: string}) => void) => void|(() => void)} [onIceRestartRequest]
 */

const REQUIRED_METHODS = [
  'sendOffer',
  'sendAnswer',
  'onOffer',
  'onAnswer',
  'sendCandidate',
  'onRemoteCandidate',
];
const ROOM_REQUIRED_METHODS = [
  'join',
  'leave',
  'onPeers',
  'createPeerSignaling',
];
const RELAY_ENVELOPE_KINDS = {
  offer: 'offer',
  answer: 'answer',
  candidate: 'candidate',
  'ice-restart-request': 'iceRestartRequest',
};

/**
 * Validate and normalize a 1:1 pair signaling source.
 *
 * The returned channel preserves the existing signaling contract while adding
 * predictable unsubscribe behavior and a `close()` method that releases every
 * active listener registered through the wrapper.
 *
 * @param {RtcSignalingSource} source
 * @returns {RtcSignalingSource & { close: () => void }}
 */
export function createPairSignaling(source) {
  assertSignalingSource(source);

  const subscriptions = new Set();
  let closed = false;

  const subscribe = (methodName, callback) => {
    if (closed) {
      throw new Error(
        `createPairSignaling: cannot call ${methodName}() after close()`,
      );
    }
    if (typeof callback !== 'function') {
      throw new TypeError(
        `createPairSignaling: ${methodName} callback must be a function`,
      );
    }

    let active = true;
    const guardedCallback = (...args) => {
      if (!active || closed) return;
      callback(...args);
    };

    const rawUnsubscribe = source[methodName](guardedCallback);
    const unsubscribe = normalizeUnsubscribe(rawUnsubscribe, methodName);

    const cleanup = () => {
      if (!active) return;
      active = false;
      subscriptions.delete(cleanup);
      unsubscribe();
    };

    subscriptions.add(cleanup);
    return cleanup;
  };

  const signaling = {
    sendOffer: (offer) => source.sendOffer(offer),
    sendAnswer: (answer) => source.sendAnswer(answer),
    onOffer: (callback) => subscribe('onOffer', callback),
    onAnswer: (callback) => subscribe('onAnswer', callback),
    sendCandidate: (candidate) => source.sendCandidate(candidate),
    onRemoteCandidate: (callback) => subscribe('onRemoteCandidate', callback),
    close() {
      if (closed) return;
      closed = true;
      let firstError;
      let hasError = false;

      for (const unsubscribe of [...subscriptions]) {
        try {
          unsubscribe();
        } catch (error) {
          if (!hasError) {
            firstError = error;
            hasError = true;
          }
        }
      }

      subscriptions.clear();
      if (hasError) {
        throw firstError;
      }
    },
  };
  if (
    typeof source.sendIceRestartRequest === 'function' &&
    typeof source.onIceRestartRequest === 'function'
  ) {
    signaling.sendIceRestartRequest = (request) =>
      source.sendIceRestartRequest(request);
    signaling.onIceRestartRequest = (callback) =>
      subscribe('onIceRestartRequest', callback);
  }
  return signaling;
}

/**
 * Adapt a generic peer-addressed relay into a 1:1 signaling source.
 *
 * Relay adapters usually expose one message stream, so this helper owns the
 * offer/answer/candidate envelope shape and routes only messages from the
 * expected remote peer.
 *
 * @param {Object} options
 * @param {string} options.remotePeerId
 * @param {(toPeerId: string, message: Object) => void|Promise<void>} options.send
 * @param {(callback: (fromPeerId: string, message: Object) => void) => void|(() => void)} options.onMessage
 * @returns {RtcSignalingSource & { close: () => void }}
 */
export function createRelayPeerSignaling(options) {
  assertRelayPeerSignalingOptions(options);

  const { remotePeerId, send, onMessage } = options;
  const listeners = {
    offer: new Set(),
    answer: new Set(),
    candidate: new Set(),
    iceRestartRequest: new Set(),
  };
  let closed = false;

  const unsubscribeMessages = normalizeUnsubscribe(
    onMessage((fromPeerId, message) => {
      if (closed) return;
      if (fromPeerId !== remotePeerId) return;
      const kind = message?.kind;
      if (!isRelayEnvelopeKind(kind)) return;

      const listenerKind = RELAY_ENVELOPE_KINDS[kind];
      const payload = message[listenerKind];
      if (payload == null) return;
      for (const callback of listeners[listenerKind]) callback(payload);
    }),
    'onMessage',
  );

  const subscribe = (kind, callback) => {
    listeners[kind].add(callback);
    return () => {
      listeners[kind].delete(callback);
    };
  };

  const pairSignaling = createPairSignaling({
    sendOffer: (offer) =>
      send(remotePeerId, {
        kind: 'offer',
        offer,
      }),
    sendAnswer: (answer) =>
      send(remotePeerId, {
        kind: 'answer',
        answer,
      }),
    onOffer: (callback) => subscribe('offer', callback),
    onAnswer: (callback) => subscribe('answer', callback),
    sendCandidate: (candidate) =>
      send(remotePeerId, {
        kind: 'candidate',
        candidate,
      }),
    onRemoteCandidate: (callback) => subscribe('candidate', callback),
    sendIceRestartRequest: (iceRestartRequest) =>
      send(remotePeerId, {
        kind: 'ice-restart-request',
        iceRestartRequest,
      }),
    onIceRestartRequest: (callback) =>
      subscribe('iceRestartRequest', callback),
  });
  const closePairSignaling = pairSignaling.close;

  return {
    ...pairSignaling,
    close() {
      if (closed) return;
      closed = true;

      const { capture, finish } = createCleanupCollector();
      capture(closePairSignaling);
      for (const bucket of Object.values(listeners)) bucket.clear();
      capture(unsubscribeMessages);
      return finish();
    },
  };
}

/**
 * Validate and normalize a room signaling source.
 *
 * Room signaling owns provider-specific presence and pair signaling. The
 * returned wrapper guards callbacks, normalizes unsubscribe behavior, wraps
 * pair signaling with createPairSignaling(), and closes active listeners.
 *
 * Cleanup policy is intentionally provider-owned: implementations decide
 * whether live peer lists are maintained through explicit leave(), heartbeat,
 * server presence, or another mechanism. If supplied, `cleanupSignaling()` is
 * called on permanent teardown and may release provider-owned listeners,
 * sockets, timers, or backend records. It is not required to delete whole room
 * state.
 *
 * @param {Object} source
 * @returns {{
 *   join: (
 *     peerId: string,
 *     data?: Record<string, unknown>,
 *   ) => void|Promise<void>,
 *   leave: (peerId: string) => void|Promise<void>,
 *   refreshPresence?: (
 *     peerId: string,
 *     data?: Record<string, unknown>,
 *   ) => void|Promise<void>,
 *   updatePresenceData?: (
 *     peerId: string,
 *     data: Record<string, unknown>,
 *   ) => void|Promise<void>,
 *   onPeers: (callback: (snapshot: {
 *     members: Array<{memberId: string, data?: Record<string, unknown>}>,
 *     departed?: Array<{memberId: string, reason: 'left'}>,
 *   }) => void) => (() => void),
 *   createPeerSignaling: (options: {
 *     localPeerId: string,
 *     remotePeerId: string,
 *   }) => RtcSignalingSource & { close: () => void },
 *   close: () => void|Promise<void>,
 * }}
 */
export function createRoomSignaling(source) {
  assertRoomSignalingSource(source);

  const subscriptions = new Set();
  const pairSignalings = new Set();
  let closed = false;

  const assertOpen = (methodName) => {
    if (closed) {
      throw new Error(
        `createRoomSignaling: cannot call ${methodName}() after close()`,
      );
    }
  };

  const subscribe = (callback) => {
    assertOpen('onPeers');
    if (typeof callback !== 'function') {
      throw new TypeError(
        'createRoomSignaling: onPeers callback must be a function',
      );
    }

    let active = true;
    const guardedCallback = (peerIds) => {
      if (!active || closed) return;
      callback(peerIds);
    };

    const rawUnsubscribe = source.onPeers(guardedCallback);
    const unsubscribe = normalizeUnsubscribe(rawUnsubscribe, 'onPeers');

    const cleanup = () => {
      if (!active) return;
      active = false;
      subscriptions.delete(cleanup);
      unsubscribe();
    };

    subscriptions.add(cleanup);
    return cleanup;
  };

  const closeAll = () => {
    const { capture, finish } = createCleanupCollector();

    for (const unsubscribe of [...subscriptions]) capture(unsubscribe);
    subscriptions.clear();

    for (const signaling of [...pairSignalings]) {
      capture(() => signaling.close());
    }
    pairSignalings.clear();

    if (typeof source.cleanupSignaling === 'function') {
      capture(() => source.cleanupSignaling());
    }

    return finish();
  };

  return {
    join: (peerId, data) => {
      assertOpen('join');
      return data === undefined
        ? source.join(peerId)
        : source.join(peerId, data);
    },
    leave: (peerId) => {
      assertOpen('leave');
      return source.leave(peerId);
    },
    refreshPresence: source.refreshPresence
      ? (peerId, data) => {
          assertOpen('refreshPresence');
          return data === undefined
            ? source.refreshPresence(peerId)
            : source.refreshPresence(peerId, data);
        }
      : undefined,
    updatePresenceData: source.updatePresenceData
      ? (peerId, data) => {
          assertOpen('updatePresenceData');
          return source.updatePresenceData(peerId, data);
        }
      : undefined,
    onPeers: subscribe,
    createPeerSignaling: (options) => {
      assertOpen('createPeerSignaling');
      const pairSource = source.createPeerSignaling(options);
      const pairSignaling = createPairSignaling(pairSource);
      pairSignalings.add(pairSignaling);
      const close = pairSignaling.close;
      return {
        ...pairSignaling,
        close() {
          pairSignalings.delete(pairSignaling);
          return close();
        },
      };
    },
    close() {
      if (closed) return;
      closed = true;
      return closeAll();
    },
  };
}

function createCleanupCollector() {
  let firstError;
  let hasError = false;
  const asyncCleanups = [];

  const rememberError = (error) => {
    if (!hasError) {
      firstError = error;
      hasError = true;
    }
  };

  return {
    capture(fn) {
      try {
        const result = fn();
        if (result && typeof result.then === 'function') {
          asyncCleanups.push(Promise.resolve(result).catch(rememberError));
        }
      } catch (error) {
        rememberError(error);
      }
    },
    finish() {
      if (asyncCleanups.length > 0) {
        return Promise.all(asyncCleanups).then(() => {
          if (hasError) throw firstError;
        });
      }
      if (hasError) throw firstError;
    },
  };
}

function assertSignalingSource(source) {
  if (!source) {
    throw new Error('createPairSignaling: source is required');
  }

  for (const methodName of REQUIRED_METHODS) {
    if (typeof source[methodName] !== 'function') {
      throw new Error(
        `createPairSignaling: source missing method "${methodName}"`,
      );
    }
  }
}

function assertRelayPeerSignalingOptions(options) {
  if (!options) {
    throw new Error('createRelayPeerSignaling: options are required');
  }
  if (typeof options.remotePeerId !== 'string' || !options.remotePeerId) {
    throw new Error(
      'createRelayPeerSignaling: remotePeerId must be a non-empty string',
    );
  }
  if (typeof options.send !== 'function') {
    throw new Error('createRelayPeerSignaling: send must be a function');
  }
  if (typeof options.onMessage !== 'function') {
    throw new Error('createRelayPeerSignaling: onMessage must be a function');
  }
}

function isRelayEnvelopeKind(kind) {
  return Object.prototype.hasOwnProperty.call(RELAY_ENVELOPE_KINDS, kind);
}

/**
 * Validate a room signaling source at dev time. Throws with a clear message
 * if any required method is missing or has the wrong type.
 *
 * @param {unknown} source
 * @returns {void}
 */
export function validateRoomSignaling(source) {
  assertRoomSignalingSource(source);
}

function assertRoomSignalingSource(source) {
  if (!source) {
    throw new Error('createRoomSignaling: source is required');
  }

  for (const methodName of ROOM_REQUIRED_METHODS) {
    if (typeof source[methodName] !== 'function') {
      throw new Error(
        `createRoomSignaling: source missing method "${methodName}"`,
      );
    }
  }
  if (
    source.refreshPresence != null &&
    typeof source.refreshPresence !== 'function'
  ) {
    throw new Error(
      'createRoomSignaling: source refreshPresence must be a function',
    );
  }
  if (
    source.updatePresenceData != null &&
    typeof source.updatePresenceData !== 'function'
  ) {
    throw new Error(
      'createRoomSignaling: source updatePresenceData must be a function',
    );
  }
  if (
    source.cleanupSignaling != null &&
    typeof source.cleanupSignaling !== 'function'
  ) {
    throw new Error(
      'createRoomSignaling: source cleanupSignaling must be a function',
    );
  }
}

function normalizeUnsubscribe(value, methodName) {
  if (value == null) {
    return () => {};
  }
  if (typeof value === 'function') {
    return value;
  }
  throw new TypeError(
    `createPairSignaling: ${methodName} must return an unsubscribe function or nothing`,
  );
}
