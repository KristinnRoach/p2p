import { server } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { startP2PSession, joinP2PSession } from '../src/session.js';
import {
  clearBrowserTabSignalingRoom,
  createBrowserTabSignaling,
} from '../examples/shared/createBrowserTabSignaling.js';

const loopbackRtcConfig = { iceServers: [] };
const itNeedsDataChannelLoopback = server.browser === 'firefox' ? it.skip : it;

function createLoopbackSignaling() {
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

function createVideoStream() {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f00';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.captureStream(5);
}

function waitForRemoteStream(session) {
  if (session.remoteStream) return Promise.resolve(session.remoteStream);
  return new Promise((resolve) => {
    session.once('remoteStream', ({ stream }) => resolve(stream));
  });
}

describe('P2P session helpers', () => {
  itNeedsDataChannelLoopback(
    'start and join a data-channel session with the friendly API',
    async () => {
      const { a, b } = createLoopbackSignaling();
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

  itNeedsDataChannelLoopback(
    'delivers initiator media tracks to the joiner',
    async () => {
      const { a, b } = createLoopbackSignaling();
      const initiatorStream = createVideoStream();
      const joinerStream = createVideoStream();
      const [host, guest] = await Promise.all([
        startP2PSession({
          signaling: a,
          localStream: initiatorStream,
          rtcConfig: loopbackRtcConfig,
        }),
        joinP2PSession({
          signaling: b,
          localStream: joinerStream,
          rtcConfig: loopbackRtcConfig,
        }),
      ]);

      try {
        const guestRemoteStream = await waitForRemoteStream(guest);
        const onLateRemoteStream = vi.fn();
        guest.on('remoteStream', onLateRemoteStream);

        expect(guestRemoteStream.getVideoTracks()).toHaveLength(1);
        expect(guestRemoteStream.getVideoTracks()[0].readyState).toBe('live');
        expect(onLateRemoteStream).toHaveBeenCalledWith(
          expect.objectContaining({ stream: guestRemoteStream }),
          expect.any(CustomEvent),
        );
      } finally {
        host.close();
        guest.close();
        for (const track of initiatorStream.getTracks()) track.stop();
        for (const track of joinerStream.getTracks()) track.stop();
      }
    },
  );

  itNeedsDataChannelLoopback(
    'delivers initiator media tracks when using browser tab signaling',
    async () => {
      const roomId = `test-${crypto.randomUUID()}`;
      clearBrowserTabSignalingRoom(roomId);
      const hostSignaling = createBrowserTabSignaling({
        roomId,
        role: 'host',
      });
      const guestSignaling = createBrowserTabSignaling({
        roomId,
        role: 'guest',
      });
      const initiatorStream = createVideoStream();
      const joinerStream = createVideoStream();

      const [host, guest] = await Promise.all([
        startP2PSession({
          signaling: hostSignaling,
          localStream: initiatorStream,
          rtcConfig: loopbackRtcConfig,
        }),
        joinP2PSession({
          signaling: guestSignaling,
          localStream: joinerStream,
          rtcConfig: loopbackRtcConfig,
        }),
      ]);

      try {
        const guestRemoteStream = await waitForRemoteStream(guest);

        expect(guestRemoteStream.getVideoTracks()).toHaveLength(1);
        expect(guestRemoteStream.getVideoTracks()[0].readyState).toBe('live');
      } finally {
        host.close();
        guest.close();
        hostSignaling.close();
        guestSignaling.close();
        clearBrowserTabSignalingRoom(roomId);
        for (const track of initiatorStream.getTracks()) track.stop();
        for (const track of joinerStream.getTracks()) track.stop();
      }
    },
  );

  itNeedsDataChannelLoopback(
    'calls onRemoteStream after session resolves',
    async () => {
      const { a, b } = createLoopbackSignaling();
      const initiatorStream = createVideoStream();
      const joinerStream = createVideoStream();
      const onRemoteStream = vi.fn();
      const [host, guest] = await Promise.all([
        startP2PSession({
          signaling: a,
          localStream: initiatorStream,
          rtcConfig: loopbackRtcConfig,
        }),
        joinP2PSession({
          signaling: b,
          localStream: joinerStream,
          rtcConfig: loopbackRtcConfig,
          onRemoteStream,
        }),
      ]);

      try {
        expect(onRemoteStream).toHaveBeenCalledWith(
          expect.objectContaining({
            stream: expect.any(MediaStream),
            track: expect.any(MediaStreamTrack),
          }),
          expect.any(CustomEvent),
        );
        expect(
          onRemoteStream.mock.calls[0][0].stream.getVideoTracks(),
        ).toHaveLength(1);
      } finally {
        host.close();
        guest.close();
        for (const track of initiatorStream.getTracks()) track.stop();
        for (const track of joinerStream.getTracks()) track.stop();
      }
    },
  );

  itNeedsDataChannelLoopback(
    'calls onRemoteTrack during startup before the session promise resolves',
    async () => {
      const { a, b } = createLoopbackSignaling();
      const initiatorStream = createVideoStream();
      const joinerStream = createVideoStream();
      const onRemoteTrack = vi.fn();
      const [host, guest] = await Promise.all([
        startP2PSession({
          signaling: a,
          localStream: initiatorStream,
          rtcConfig: loopbackRtcConfig,
        }),
        joinP2PSession({
          signaling: b,
          localStream: joinerStream,
          rtcConfig: loopbackRtcConfig,
          onRemoteTrack,
        }),
      ]);

      try {
        expect(onRemoteTrack).toHaveBeenCalledWith(
          expect.objectContaining({
            stream: expect.any(MediaStream),
            track: expect.any(MediaStreamTrack),
          }),
          expect.any(CustomEvent),
        );
      } finally {
        host.close();
        guest.close();
        for (const track of initiatorStream.getTracks()) track.stop();
        for (const track of joinerStream.getTracks()) track.stop();
      }
    },
  );

  it('assembles a remote stream from receiver tracks when no track event fires', async () => {
    const OriginalRTCPeerConnection = globalThis.RTCPeerConnection;
    const remoteTrack = createVideoStream().getVideoTracks()[0];
    let offerHandler;
    const onRemoteStream = vi.fn();

    class FakePeerConnection extends EventTarget {
      constructor() {
        super();
        this.signalingState = 'stable';
        this.connectionState = 'new';
        this.remoteDescription = null;
        this.localDescription = null;
        this.onicecandidate = null;
        this.receivers = [];
      }

      setRemoteDescription(description) {
        this.remoteDescription = description;
        this.signalingState = 'have-remote-offer';
        this.receivers = [{ track: remoteTrack }];
        return Promise.resolve();
      }

      createAnswer() {
        return Promise.resolve({ type: 'answer', sdp: 'answer-sdp' });
      }

      setLocalDescription(description) {
        this.localDescription = description;
        this.signalingState = 'stable';
        return Promise.resolve();
      }

      addIceCandidate() {
        return Promise.resolve();
      }

      getReceivers() {
        return this.receivers;
      }

      close() {
        this.signalingState = 'closed';
      }
    }

    globalThis.RTCPeerConnection = FakePeerConnection;

    try {
      const sessionPromise = joinP2PSession({
        signaling: {
          sendOffer: vi.fn(),
          sendAnswer: vi.fn(),
          onOffer: (callback) => {
            offerHandler = callback;
          },
          onAnswer: vi.fn(),
          sendCandidate: vi.fn(),
          onRemoteCandidate: vi.fn(),
        },
        onRemoteStream,
      });

      await Promise.resolve();
      offerHandler({ type: 'offer', sdp: 'offer-sdp' });
      const session = await sessionPromise;

      try {
        expect(onRemoteStream).toHaveBeenCalledWith(
          expect.objectContaining({
            stream: expect.any(MediaStream),
            track: remoteTrack,
          }),
          expect.any(CustomEvent),
        );
        expect(session.remoteStream.getTracks()).toContain(remoteTrack);
      } finally {
        session.close();
      }
    } finally {
      globalThis.RTCPeerConnection = OriginalRTCPeerConnection;
      remoteTrack.stop();
    }
  });

  itNeedsDataChannelLoopback(
    'calls onDataChannel when the initiator creates a data channel during startup',
    async () => {
      const { a, b } = createLoopbackSignaling();
      const onDataChannel = vi.fn();
      const [host, guest] = await Promise.all([
        startP2PSession({
          signaling: a,
          dataChannel: true,
          rtcConfig: loopbackRtcConfig,
          onDataChannel,
        }),
        joinP2PSession({
          signaling: b,
          rtcConfig: loopbackRtcConfig,
        }),
      ]);

      try {
        expect(onDataChannel).toHaveBeenCalledWith(
          expect.objectContaining({
            channel: expect.any(RTCDataChannel),
          }),
          expect.any(CustomEvent),
        );
        expect(onDataChannel.mock.calls[0][0].channel.label).toBe('data');
      } finally {
        host.close();
        guest.close();
      }
    },
  );

  itNeedsDataChannelLoopback(
    'calls onDataChannel when the joiner receives a data channel',
    async () => {
      const { a, b } = createLoopbackSignaling();
      let resolveDataChannel;
      const dataChannelReceived = new Promise((resolve) => {
        resolveDataChannel = resolve;
      });
      const onDataChannel = vi.fn((detail) => {
        resolveDataChannel(detail.channel);
      });
      const [host, guest] = await Promise.all([
        startP2PSession({
          signaling: a,
          dataChannel: true,
          rtcConfig: loopbackRtcConfig,
        }),
        joinP2PSession({
          signaling: b,
          rtcConfig: loopbackRtcConfig,
          onDataChannel,
        }),
      ]);

      try {
        const channel = await dataChannelReceived;

        expect(onDataChannel).toHaveBeenCalledWith(
          expect.objectContaining({ channel }),
          expect.any(CustomEvent),
        );
        expect(channel.label).toBe('data');
      } finally {
        host.close();
        guest.close();
      }
    },
  );

  it('propagates start timeout errors', async () => {
    const { b } = createLoopbackSignaling();

    await expect(
      joinP2PSession({ signaling: b, startTimeoutMs: 1 }),
    ).rejects.toThrow(/timed out/);
  });

  it('aborts while waiting for the data channel to open', async () => {
    const { a } = createLoopbackSignaling();
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
