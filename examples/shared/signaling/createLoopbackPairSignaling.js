export function createLoopbackPairSignaling() {
  const offers = {};
  const answers = {};
  const candidates = { host: [], guest: [] };

  const side = (self, other) => ({
    sendOffer: async (offer) => {
      const handler = offers[other];
      if (!handler) {
        throw new Error(
          `createLoopbackSignaling: ${self} cannot send offer; ${other} has no offer handler`,
        );
      }
      return handler(offer);
    },
    sendAnswer: async (answer) => {
      const handler = answers[other];
      if (!handler) {
        throw new Error(
          `createLoopbackSignaling: ${self} cannot send answer; ${other} has no answer handler`,
        );
      }
      return handler(answer);
    },
    onOffer: (cb) => {
      offers[self] = cb;
    },
    onAnswer: (cb) => {
      answers[self] = cb;
    },
    sendCandidate: async (candidate) => {
      for (const cb of candidates[other]) cb(candidate);
    },
    onRemoteCandidate: (cb) => {
      candidates[self].push(cb);
    },
  });

  return {
    host: side('host', 'guest'),
    guest: side('guest', 'host'),
  };
}
