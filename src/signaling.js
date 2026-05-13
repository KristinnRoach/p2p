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

  return {
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
 *   join: (peerId: string) => void|Promise<void>,
 *   leave: (peerId: string) => void|Promise<void>,
 *   refreshPresence?: (peerId: string) => void|Promise<void>,
 *   onPeers: (callback: (peerIds: string[]) => void) => (() => void),
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
    join: (peerId) => {
      assertOpen('join');
      return source.join(peerId);
    },
    leave: (peerId) => {
      assertOpen('leave');
      return source.leave(peerId);
    },
    refreshPresence: source.refreshPresence
      ? (peerId) => {
          assertOpen('refreshPresence');
          return source.refreshPresence(peerId);
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
