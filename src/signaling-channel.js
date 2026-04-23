const REQUIRED_METHODS = [
  'sendOffer',
  'sendAnswer',
  'onOffer',
  'onAnswer',
  'sendCandidate',
  'onRemoteCandidate',
];

/**
 * Validate and normalize a signaling object.
 *
 * The returned channel preserves the existing signaling contract while adding
 * predictable unsubscribe behavior and a `close()` method that releases every
 * active listener registered through the wrapper.
 *
 * @param {Object} source
 * @returns {import('./signaling-transport.js').DataSignalingChannel & {
 *   close: () => void,
 * }}
 */
export function createSignalingChannel(source) {
  assertSignalingSource(source);

  const subscriptions = new Set();
  let closed = false;

  const subscribe = (methodName, callback) => {
    if (closed) {
      throw new Error(
        `createSignalingChannel: cannot call ${methodName}() after close()`,
      );
    }
    if (typeof callback !== 'function') {
      throw new TypeError(
        `createSignalingChannel: ${methodName} callback must be a function`,
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

function assertSignalingSource(source) {
  if (!source) {
    throw new Error('createSignalingChannel: source is required');
  }

  for (const methodName of REQUIRED_METHODS) {
    if (typeof source[methodName] !== 'function') {
      throw new Error(
        `createSignalingChannel: source missing method "${methodName}"`,
      );
    }
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
    `createSignalingChannel: ${methodName} must return an unsubscribe function or nothing`,
  );
}
