export function createLoopbackSignaling() {
  const offers = {};
  const answers = {};
  const candidates = { host: [], guest: [] };

  const side = (self, other) => ({
    sendOffer: async (offer) => offers[other]?.(offer),
    sendAnswer: async (answer) => answers[other]?.(answer),
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
