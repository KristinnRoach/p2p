import { server } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
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

  it('aborts while waiting for the data channel to open', async () => {
    const { a } = createLoopbackPair();
    const controller = new AbortController();
    let resolveSendOffer;
    const sendOfferCalled = new Promise((resolve) => {
      resolveSendOffer = resolve;
    });

    const promise = startP2PSession({
      signaling: {
        ...a,
        sendOffer: async () => {
          resolveSendOffer();
        },
      },
      dataChannel: true,
      rtcConfig: loopbackRtcConfig,
      signal: controller.signal,
      dataChannelOpenTimeoutMs: 10000,
    });

    await sendOfferCalled;
    await Promise.resolve();
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects when the peer fails while waiting for data channel open', async () => {
    const OriginalRTCPeerConnection = globalThis.RTCPeerConnection;
    let latestPc;
    let resolveSendOffer;
    const sendOfferCalled = new Promise((resolve) => {
      resolveSendOffer = resolve;
    });

    class FakePeerConnection extends EventTarget {
      constructor() {
        super();
        latestPc = this;
        this.connectionState = 'new';
        this.signalingState = 'stable';
        this.remoteDescription = null;
        this.localDescription = null;
        this.onicecandidate = null;
      }

      createDataChannel(label) {
        const channel = new EventTarget();
        channel.label = label;
        channel.readyState = 'connecting';
        channel.close = vi.fn();
        channel.send = vi.fn();
        return channel;
      }

      createOffer() {
        return Promise.resolve({ type: 'offer', sdp: 'offer-sdp' });
      }

      setLocalDescription(description) {
        this.localDescription = description;
        this.signalingState = 'have-local-offer';
        return Promise.resolve();
      }

      addIceCandidate() {
        return Promise.resolve();
      }

      close() {
        this.connectionState = 'closed';
        this.signalingState = 'closed';
      }
    }

    globalThis.RTCPeerConnection = FakePeerConnection;

    try {
      const promise = startP2PSession({
        signaling: {
          sendOffer: async () => {
            resolveSendOffer();
          },
          sendAnswer: vi.fn(),
          onOffer: vi.fn(),
          onAnswer: vi.fn(),
          sendCandidate: vi.fn(),
          onRemoteCandidate: vi.fn(),
        },
        dataChannel: true,
        dataChannelOpenTimeoutMs: 10000,
      });

      await sendOfferCalled;
      await Promise.resolve();

      latestPc.connectionState = 'failed';
      latestPc.dispatchEvent(new Event('connectionstatechange'));

      await expect(promise).rejects.toThrow(
        /peer failed before data channel open/,
      );
    } finally {
      globalThis.RTCPeerConnection = OriginalRTCPeerConnection;
    }
  });
});
