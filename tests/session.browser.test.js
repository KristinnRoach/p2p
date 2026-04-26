import { server } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { startP2PSession, joinP2PSession } from '../src/session.js';

const loopbackRtcConfig = { iceServers: [] };
const itNeedsDataChannelLoopback =
  server.browser === 'firefox' ? it.skip : it;

function createLoopbackPair() {
  const offerListeners = { a: null, b: null };
  const answerListeners = { a: null, b: null };
  const candidateListeners = { a: [], b: [] };

  const makeSide = (self, other) => ({
    sendOffer: async (offer) => offerListeners[other]?.(offer),
    sendAnswer: async (answer) => answerListeners[other]?.(answer),
    onOffer: (cb) => {
      offerListeners[self] = cb;
    },
    onAnswer: (cb) => {
      answerListeners[self] = cb;
    },
    sendCandidate: async (candidate) => {
      for (const cb of candidateListeners[other]) cb(candidate);
    },
    onRemoteCandidate: (cb) => {
      candidateListeners[self].push(cb);
    },
  });

  return { a: makeSide('a', 'b'), b: makeSide('b', 'a') };
}

async function waitForOpen(session) {
  if (session.dataChannel?.readyState === 'open') return;
  await new Promise((resolve) => session.once('open', resolve));
}

describe('P2P session helpers', () => {
  itNeedsDataChannelLoopback(
    'start and join a data-channel session with the friendly API',
    async () => {
      const { a, b } = createLoopbackPair();
      const [host, guest] = await Promise.all([
        startP2PSession({
          signaling: a,
          dataChannel: true,
          rtcConfig: loopbackRtcConfig,
        }),
        joinP2PSession({
          signaling: b,
          dataChannel: true,
          rtcConfig: loopbackRtcConfig,
        }),
      ]);

      try {
        await waitForOpen(host);
        const received = new Promise((resolve) => {
          guest.once('message', ({ data }) => resolve(data));
        });

        host.send('hello from session');

        expect(await received).toBe('hello from session');
        expect(host.role).toBe('initiator');
        expect(guest.role).toBe('joiner');
      } finally {
        host.close();
        guest.close();
      }
    },
  );

  it('propagates start timeout errors', async () => {
    const { b } = createLoopbackPair();

    await expect(
      joinP2PSession({ signaling: b, startTimeoutMs: 1 }),
    ).rejects.toThrow(/timed out/);
  });
});
