// tests/peer.browser.test.js
//
// Browser-mode tests for the Peer class. Uses real RTCPeerConnection APIs.
// Two Peer instances are wired through an in-memory loopback signaling
// channel so offers/answers/ICE candidates flow between them end-to-end.

import { server } from 'vitest/browser';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Peer, PEER_STATES } from '../src/peer.js';
import { createLoopbackSignaling as createSharedLoopbackSignaling } from '../examples/shared/index.js';

const loopbackRtcConfig = { iceServers: [] };
// Firefox headless in Playwright applies stricter local WebRTC restrictions for
// data-channel-only loopback peers: SDP completes, then both peers fail ICE.
// Keep these real transport assertions in Chromium/WebKit and continue running
// the Peer lifecycle/unit coverage in Firefox below.
const itNeedsDataChannelLoopback = server.browser === 'firefox' ? it.skip : it;

function createLoopbackSignaling() {
  const { host, guest } = createSharedLoopbackSignaling();
  return { a: host, b: guest };
}

function createVideoTrack() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas.captureStream().getVideoTracks()[0];
}

describe('Peer', () => {
  let peers;

  afterEach(() => {
    peers?.forEach((p) => {
      try {
        p.dispose();
      } catch (_) {}
    });
    peers = null;
  });

  describe('construction', () => {
    it('throws on invalid role', () => {
      const { a } = createLoopbackSignaling();
      expect(() => new Peer({ role: 'observer', signaling: a })).toThrow(
        /invalid role/,
      );
    });

    it('throws when signaling is missing', () => {
      expect(() => new Peer({ role: 'initiator' })).toThrow(
        /signaling channel is required/,
      );
    });

    it('throws when signaling is incomplete', () => {
      expect(
        () =>
          new Peer({
            role: 'initiator',
            signaling: { sendOffer: () => {} },
          }),
      ).toThrow(/missing method/);
    });

    it('starts in idle state', () => {
      const { a } = createLoopbackSignaling();
      const peer = new Peer({ role: 'initiator', signaling: a });
      expect(peer.state).toBe(PEER_STATES.IDLE);
      expect(peer.role).toBe('initiator');
      peer.dispose();
    });

    it.each([
      [{ maxAttempts: 0 }, 'maxAttempts'],
      [{ maxAttempts: 1.5 }, 'maxAttempts'],
      [{ disconnectedGraceMs: -1 }, 'disconnectedGraceMs'],
      [{ attemptTimeoutMs: Infinity }, 'attemptTimeoutMs'],
      [{ backoffFactor: 0.5 }, 'backoffFactor'],
    ])('rejects invalid ICE recovery option %o', (iceRecovery, name) => {
      const { a } = createLoopbackSignaling();
      expect(
        () =>
          new Peer({
            role: 'initiator',
            signaling: a,
            iceRecovery,
          }),
      ).toThrow(new RegExp(name));
    });

    it('re-emits a native track event that upgrades fallback streams', () => {
      const { a } = createLoopbackSignaling();
      const peer = new Peer({ role: 'initiator', signaling: a });
      const track = createVideoTrack();
      const stream = new MediaStream([track]);
      const onTrack = vi.fn();

      try {
        peer.addEventListener('track', onTrack);

        peer._emitRemoteTrack(track, [], 'fallback');
        peer._emitRemoteTrack(track, [], 'fallback');
        peer._emitRemoteTrack(track, [stream], 'native');
        peer._emitRemoteTrack(track, [stream], 'native');

        expect(onTrack).toHaveBeenCalledTimes(2);
        expect(onTrack.mock.calls[0][0].detail.streams).toEqual([]);
        expect(onTrack.mock.calls[1][0].detail.streams).toEqual([stream]);
      } finally {
        peer.dispose();
        track.stop();
      }
    });
  });

  describe('data-only peer negotiation', () => {
    itNeedsDataChannelLoopback(
      'lets a joiner request a real ICE restart on the existing connection',
      async () => {
        const { a, b } = createLoopbackSignaling();
        const sendOffer = a.sendOffer;
        const sendAnswer = b.sendAnswer;
        a.sendOffer = vi.fn((offer) => sendOffer(offer));
        b.sendAnswer = vi.fn((answer) => sendAnswer(answer));
        const initiator = new Peer({
          role: 'initiator',
          signaling: a,
          dataChannel: true,
          rtcConfig: loopbackRtcConfig,
          iceRecovery: { maxAttempts: 1, attemptTimeoutMs: 3000 },
        });
        const joiner = new Peer({
          role: 'joiner',
          signaling: b,
          rtcConfig: loopbackRtcConfig,
          iceRecovery: { maxAttempts: 1, attemptTimeoutMs: 3000 },
        });
        peers = [initiator, joiner];
        const connected = vi.fn();
        initiator.on('connected', connected);

        await withTimeout(
          Promise.all([initiator.start(), joiner.start()]),
          5000,
          'initial SDP',
        );
        await Promise.all([
          waitForIceConnected(initiator.pc),
          waitForIceConnected(joiner.pc),
        ]);
        if (initiator.state !== PEER_STATES.CONNECTED) {
          await withTimeout(
            new Promise((resolve) => initiator.once('connected', resolve)),
            5000,
            'initial connected event',
          );
        }
        if (joiner.state !== PEER_STATES.CONNECTED) {
          await withTimeout(
            new Promise((resolve) => joiner.once('connected', resolve)),
            5000,
            'joiner connected event',
          );
        }
        const pc = initiator.pc;
        const initialUfrag = getIceUfrag(pc.localDescription?.sdp);
        const recoveryResult = new Promise((resolve) => {
          initiator.once('iceReconnected', (detail) =>
            resolve({ type: 'reconnected', detail }),
          );
          initiator.once('iceReconnectFailed', (detail) =>
            resolve({ type: 'failed', detail }),
          );
        });
        const joinerRecovery = new Promise((resolve) => {
          joiner.once('iceReconnected', resolve);
        });

        joiner._startIceRecovery('failed');
        const [result] = await withTimeout(
          Promise.all([recoveryResult, joinerRecovery]),
          5000,
          'ICE recovery events',
        );
        expect(result.type, result.detail.error?.message).toBe('reconnected');

        expect(initiator.pc).toBe(pc);
        expect(a.sendOffer).toHaveBeenCalledTimes(2);
        expect(b.sendAnswer).toHaveBeenCalledTimes(2);
        expect(connected).toHaveBeenCalledTimes(1);
        expect(['connected', 'completed']).toContain(pc.iceConnectionState);
        expect(['connected', 'completed']).toContain(
          joiner.pc.iceConnectionState,
        );
        const restartedUfrag = getIceUfrag(pc.localDescription?.sdp);
        if (initialUfrag && restartedUfrag) {
          expect(restartedUfrag).not.toBe(initialUfrag);
        }
        expect(initiator._iceRecovery.attempt).toBe(0);

        const secondRecovery = new Promise((resolve) => {
          initiator.once('iceReconnected', resolve);
        });
        initiator._startIceRecovery('failed');
        await withTimeout(secondRecovery, 5000, 'second ICE recovery');
        expect(a.sendOffer).toHaveBeenCalledTimes(3);
        expect(initiator._iceRecovery.attempt).toBe(0);
      },
    );

    itNeedsDataChannelLoopback(
      'exchanges offer/answer and opens a data channel',
      async () => {
        const { a, b } = createLoopbackSignaling();

        const initiator = new Peer({
          role: 'initiator',
          signaling: a,
          dataChannel: true,
          rtcConfig: loopbackRtcConfig,
        });
        const joiner = new Peer({
          role: 'joiner',
          signaling: b,
          rtcConfig: loopbackRtcConfig,
        });
        peers = [initiator, joiner];

        const joinerChannel = new Promise((resolve) => {
          joiner.once('datachannel', ({ channel }) => resolve(channel));
        });
        const initiatorOpen = new Promise((resolve) => {
          initiator.once('open', () => resolve());
        });

        await Promise.all([initiator.start(), joiner.start()]);

        const channel = await joinerChannel;
        expect(channel).toBeDefined();
        expect(channel.label).toBe('data');

        await initiatorOpen;
        expect(initiator.dataChannel).toBeDefined();
        expect(initiator.dataChannel.readyState).toBe('open');
      },
    );

    itNeedsDataChannelLoopback(
      'delivers messages from initiator to joiner',
      async () => {
        const { a, b } = createLoopbackSignaling();

        const initiator = new Peer({
          role: 'initiator',
          signaling: a,
          dataChannel: true,
          rtcConfig: loopbackRtcConfig,
        });
        const joiner = new Peer({
          role: 'joiner',
          signaling: b,
          rtcConfig: loopbackRtcConfig,
        });
        peers = [initiator, joiner];

        const received = new Promise((resolve) => {
          joiner.once('message', ({ data }) => resolve(data));
        });
        const initiatorOpen = new Promise((resolve) => {
          initiator.once('open', () => resolve());
        });

        await Promise.all([initiator.start(), joiner.start()]);
        await initiatorOpen;

        initiator.send('hello from initiator');

        expect(await received).toBe('hello from initiator');
      },
    );

    itNeedsDataChannelLoopback(
      'emits statechange and connected events',
      async () => {
        const { a, b } = createLoopbackSignaling();

        const initiator = new Peer({
          role: 'initiator',
          signaling: a,
          dataChannel: true,
          rtcConfig: loopbackRtcConfig,
        });
        const joiner = new Peer({
          role: 'joiner',
          signaling: b,
          rtcConfig: loopbackRtcConfig,
        });
        peers = [initiator, joiner];

        const stateChanges = [];
        initiator.on('statechange', ({ state }) => stateChanges.push(state));

        const connected = new Promise((resolve) => {
          initiator.once('connected', () => resolve());
        });

        await Promise.all([initiator.start(), joiner.start()]);
        await connected;

        expect(stateChanges).toContain(PEER_STATES.CONNECTING);
        expect(stateChanges).toContain(PEER_STATES.CONNECTED);
        expect(initiator.state).toBe(PEER_STATES.CONNECTED);
      },
    );

    it('start() is idempotent — returns the same promise on repeat calls', () => {
      const { a } = createLoopbackSignaling();
      const peer = new Peer({
        role: 'initiator',
        signaling: a,
        dataChannel: true,
      });
      peers = [peer];

      const p1 = peer.start();
      const p2 = peer.start();
      expect(p1).toBe(p2);
    });

    it('start() resolves without starting after dispose()', async () => {
      const { a } = createLoopbackSignaling();
      const peer = new Peer({
        role: 'initiator',
        signaling: a,
        dataChannel: true,
      });
      peers = [peer];
      peer._startInitiator = vi.fn();

      peer.dispose();
      await expect(peer.start()).resolves.toBeUndefined();

      expect(peer._startInitiator).not.toHaveBeenCalled();
      expect(peer.state).toBe(PEER_STATES.CLOSED);
    });

    it('keeps closed state when start() fails after dispose()', async () => {
      const { a } = createLoopbackSignaling();
      const peer = new Peer({
        role: 'initiator',
        signaling: a,
        dataChannel: true,
      });
      peers = [peer];
      const startError = new Error('start failed');
      const onError = vi.fn();
      peer._startInitiator = vi.fn(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(startError), 0);
          }),
      );
      peer.on('error', onError);

      const startPromise = peer.start();
      peer.dispose();
      await expect(startPromise).rejects.toThrow(/closed before start/);

      expect(onError).toHaveBeenCalledWith(
        { error: expect.any(Error), phase: 'start' },
        expect.any(CustomEvent),
      );
      expect(onError.mock.calls[0][0].error.message).toMatch(
        /closed before start/,
      );
      expect(peer.state).toBe(PEER_STATES.CLOSED);
    });

    it('rejects and skips startup when dispose() runs during connecting statechange', async () => {
      const { a } = createLoopbackSignaling();
      const peer = new Peer({
        role: 'initiator',
        signaling: a,
        dataChannel: true,
      });
      peers = [peer];
      peer._startInitiator = vi.fn();
      peer.on('statechange', ({ state }) => {
        if (state === PEER_STATES.CONNECTING) {
          peer.dispose();
        }
      });

      await expect(peer.start()).rejects.toThrow(/closed before start/);

      expect(peer._startInitiator).not.toHaveBeenCalled();
      expect(peer._pendingStartReject).toBeNull();
      expect(peer.state).toBe(PEER_STATES.CLOSED);
    });

    it('rejects and closes when startTimeoutMs elapses', async () => {
      const { b } = createLoopbackSignaling();
      const joiner = new Peer({ role: 'joiner', signaling: b });
      peers = [joiner];

      await expect(joiner.start({ startTimeoutMs: 1 })).rejects.toThrow(
        /timed out/,
      );
      expect(joiner.state).toBe(PEER_STATES.CLOSED);
    });

    it('rejects and closes when connectedTimeoutMs elapses', async () => {
      const signaling = {
        sendOffer: vi.fn(),
        sendAnswer: vi.fn(),
        onOffer: vi.fn(),
        onAnswer: vi.fn(),
        sendCandidate: vi.fn(),
        onRemoteCandidate: vi.fn(),
      };
      const initiator = new Peer({
        role: 'initiator',
        signaling,
        dataChannel: true,
        rtcConfig: loopbackRtcConfig,
      });
      peers = [initiator];

      await expect(initiator.start({ connectedTimeoutMs: 1 })).rejects.toThrow(
        /connection timed out/,
      );
      expect(initiator.state).toBe(PEER_STATES.CLOSED);
    });

    it('rejects and closes when start() is aborted', async () => {
      const { b } = createLoopbackSignaling();
      const controller = new AbortController();
      const joiner = new Peer({ role: 'joiner', signaling: b });
      peers = [joiner];

      const startPromise = joiner.start({ signal: controller.signal });
      await Promise.resolve();
      controller.abort();

      await expect(startPromise).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(joiner.state).toBe(PEER_STATES.CLOSED);
    });
  });

  describe('send()', () => {
    it('throws if no data channel was configured', () => {
      const { a } = createLoopbackSignaling();
      const peer = new Peer({ role: 'initiator', signaling: a });
      peers = [peer];
      expect(() => peer.send('nope')).toThrow(/no data channel/);
    });

    it('throws if channel is not open yet', () => {
      const { a } = createLoopbackSignaling();
      const peer = new Peer({
        role: 'initiator',
        signaling: a,
        dataChannel: true,
      });
      peers = [peer];
      // Data channel is created synchronously in start(); invoke lifecycle
      // so _dataChannel is bound but still 'connecting'.
      peer.start();
      expect(() => peer.send('early')).toThrow(/not open/);
    });
  });

  describe('dispose()', () => {
    it('transitions to closed state and is safe to call twice', () => {
      const { a } = createLoopbackSignaling();
      const peer = new Peer({ role: 'initiator', signaling: a });

      peer.dispose();
      expect(peer.state).toBe(PEER_STATES.CLOSED);

      // Second call is a no-op
      peer.dispose();
      expect(peer.state).toBe(PEER_STATES.CLOSED);
    });

    it('cleans up signaling subscriptions created during start()', async () => {
      const answerUnsubscribe = vi.fn();
      const candidateUnsubscribe = vi.fn();
      const signaling = {
        sendOffer: vi.fn(() => Promise.resolve()),
        sendAnswer: vi.fn(() => Promise.resolve()),
        onOffer: vi.fn(),
        onAnswer: vi.fn(() => answerUnsubscribe),
        sendCandidate: vi.fn(),
        onRemoteCandidate: vi.fn(() => candidateUnsubscribe),
      };
      const peer = new Peer({
        role: 'initiator',
        signaling,
        dataChannel: true,
        rtcConfig: loopbackRtcConfig,
      });

      await peer.start();
      peer.dispose();
      peer.dispose();

      expect(answerUnsubscribe).toHaveBeenCalledTimes(1);
      expect(candidateUnsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('ICE recovery policy', () => {
    it('keeps recovery disabled when the option is omitted or false', () => {
      for (const iceRecovery of [undefined, false]) {
        const { a } = createLoopbackSignaling();
        const peer = new Peer({
          role: 'initiator',
          signaling: a,
          iceRecovery,
        });
        peer._pc = { iceConnectionState: 'failed' };
        peer._iceRecovery.initiallyConnected = true;
        peer._startIceRecovery = vi.fn();

        peer._handleIceConnectionStateChange();

        expect(peer._startIceRecovery).not.toHaveBeenCalled();
        peer.dispose();
      }
    });

    it('ignores ICE failures before the initial connection', () => {
      const { a } = createLoopbackSignaling();
      const peer = new Peer({
        role: 'initiator',
        signaling: a,
        iceRecovery: {},
      });
      peer._pc = { iceConnectionState: 'failed' };
      peer._startIceRecovery = vi.fn();

      peer._handleIceConnectionStateChange();

      expect(peer._startIceRecovery).not.toHaveBeenCalled();
      peer.dispose();
    });

    it('retries with backoff, caps attempts, and emits one terminal event', async () => {
      vi.useFakeTimers();
      const { a } = createLoopbackSignaling();
      const peer = new Peer({
        role: 'initiator',
        signaling: a,
        iceRecovery: {
          maxAttempts: 2,
          attemptTimeoutMs: 10,
          initialBackoffMs: 5,
        },
      });
      const restartIce = vi.fn();
      peer._pc = {
        iceConnectionState: 'failed',
        restartIce,
        createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'offer' })),
        setLocalDescription: vi.fn(),
      };
      peer._iceRecovery.initiallyConnected = true;
      const reconnecting = vi.fn();
      const failed = vi.fn();
      peer.on('iceReconnecting', reconnecting);
      peer.on('iceReconnectFailed', failed);

      peer._startIceRecovery('failed');
      await vi.runAllTimersAsync();

      expect(restartIce).toHaveBeenCalledTimes(2);
      expect(reconnecting.mock.calls.map(([detail]) => detail.nextDelayMs)).toEqual([
        0,
        5,
      ]);
      expect(failed).toHaveBeenCalledTimes(1);
      expect(failed.mock.calls[0][0]).toMatchObject({
        attempts: 2,
        reason: 'failed',
      });
      peer.dispose();
      vi.useRealTimers();
    });

    it('refreshes TURN credentials before restarting ICE', async () => {
      const refreshError = new Error('credentials expired');
      const manager = {
        ensureFresh: vi.fn(() => Promise.reject(refreshError)),
        removePeerConnection: vi.fn(),
        dispose: vi.fn(),
      };
      const { a } = createLoopbackSignaling();
      const peer = new Peer({
        role: 'initiator',
        signaling: a,
        iceRecovery: { maxAttempts: 1 },
        _iceServersManager: manager,
      });
      const restartIce = vi.fn();
      peer._pc = { iceConnectionState: 'failed', restartIce };
      peer._iceRecovery.initiallyConnected = true;
      const onError = vi.fn();
      peer.on('error', onError);
      const failed = new Promise((resolve) => {
        peer.once('iceReconnectFailed', resolve);
      });

      peer._startIceRecovery('failed');
      await failed;

      expect(manager.ensureFresh).toHaveBeenCalledWith('ice-restart');
      expect(restartIce).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(
        { error: refreshError, phase: 'ice-restart' },
        expect.any(CustomEvent),
      );
      peer.dispose();
    });

    it('cancels disconnected grace without consuming an attempt', async () => {
      vi.useFakeTimers();
      const { a } = createLoopbackSignaling();
      const peer = new Peer({
        role: 'initiator',
        signaling: a,
        iceRecovery: { disconnectedGraceMs: 50 },
      });
      peer._pc = { iceConnectionState: 'disconnected' };
      peer._iceRecovery.initiallyConnected = true;
      const reconnecting = vi.fn();
      peer.on('iceReconnecting', reconnecting);

      peer._handleIceConnectionStateChange();
      peer._pc.iceConnectionState = 'connected';
      peer._handleIceConnectionStateChange();
      await vi.advanceTimersByTimeAsync(50);

      expect(reconnecting).not.toHaveBeenCalled();
      expect(peer._iceRecovery.attempt).toBe(0);
      peer.dispose();
      vi.useRealTimers();
    });

    it('coalesces repeated failures and disposal cancels pending work', async () => {
      vi.useFakeTimers();
      const { a } = createLoopbackSignaling();
      const peer = new Peer({
        role: 'initiator',
        signaling: a,
        iceRecovery: { attemptTimeoutMs: 100 },
      });
      peer._pc = {
        iceConnectionState: 'failed',
        restartIce: vi.fn(),
        createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'offer' })),
        setLocalDescription: vi.fn(),
      };
      peer._iceRecovery.initiallyConnected = true;
      const reconnecting = vi.fn();
      const failed = vi.fn();
      peer.on('iceReconnecting', reconnecting);
      peer.on('iceReconnectFailed', failed);

      peer._handleIceConnectionStateChange();
      peer._handleIceConnectionStateChange();
      await Promise.resolve();
      expect(reconnecting).toHaveBeenCalledOnce();

      peer.dispose();
      await vi.runAllTimersAsync();

      expect(failed).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('fails visibly when a recovering joiner cannot request a restart', () => {
      const { b } = createLoopbackSignaling();
      delete b.sendIceRestartRequest;
      delete b.onIceRestartRequest;
      const peer = new Peer({
        role: 'joiner',
        signaling: b,
        iceRecovery: {},
      });
      peer._pc = { iceConnectionState: 'failed' };
      peer._iceRecovery.initiallyConnected = true;
      const onError = vi.fn();
      const failed = vi.fn();
      peer.on('error', onError);
      peer.on('iceReconnectFailed', failed);

      peer._startIceRecovery('failed');

      expect(onError).toHaveBeenCalledWith(
        { error: expect.any(Error), phase: 'ice-restart-request' },
        expect.any(CustomEvent),
      );
      expect(failed).toHaveBeenCalledOnce();
      peer.dispose();
    });

    it('ignores replayed ICE restart request IDs', () => {
      let onRequest;
      const { a } = createLoopbackSignaling();
      a.onIceRestartRequest = (callback) => {
        onRequest = callback;
      };
      const peer = new Peer({
        role: 'initiator',
        signaling: a,
        iceRecovery: {},
      });
      peer._iceRecovery.initiallyConnected = true;
      peer._startIceRecovery = vi.fn();
      peer._subscribeToIceRestartRequests();

      onRequest({ requestId: 'same-request' });
      onRequest({ requestId: 'same-request' });

      expect(peer._startIceRecovery).toHaveBeenCalledOnce();
      expect(peer._startIceRecovery).toHaveBeenCalledWith('remote-request');
      peer.dispose();
    });
  });

  describe('on/once sugar', () => {
    it('on() returns an unsubscribe function', () => {
      const { a } = createLoopbackSignaling();
      const peer = new Peer({ role: 'initiator', signaling: a });
      peers = [peer];

      const handler = vi.fn();
      const off = peer.on('statechange', handler);

      peer.dispose();
      expect(handler).toHaveBeenCalled();

      handler.mockClear();
      off();
      peer.dispatchEvent(new CustomEvent('statechange', { detail: {} }));
      expect(handler).not.toHaveBeenCalled();
    });

    it('off() removes a listener added with on()', () => {
      const { a } = createLoopbackSignaling();
      const peer = new Peer({ role: 'initiator', signaling: a });
      peers = [peer];

      const handler = vi.fn();
      peer.on('statechange', handler);
      peer.off('statechange', handler);

      peer.dispatchEvent(new CustomEvent('statechange', { detail: {} }));
      expect(handler).not.toHaveBeenCalled();
    });

    it('once() auto-unsubscribes after the first fire', () => {
      const { a } = createLoopbackSignaling();
      const peer = new Peer({ role: 'initiator', signaling: a });
      peers = [peer];

      const handler = vi.fn();
      peer.once('statechange', handler);

      peer.dispatchEvent(new CustomEvent('statechange', { detail: {} }));
      peer.dispatchEvent(new CustomEvent('statechange', { detail: {} }));

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('off() removes a listener added with once() before it fires', () => {
      const { a } = createLoopbackSignaling();
      const peer = new Peer({ role: 'initiator', signaling: a });
      peers = [peer];

      const handler = vi.fn();
      peer.once('statechange', handler);
      peer.off('statechange', handler);

      peer.dispatchEvent(new CustomEvent('statechange', { detail: {} }));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('joiner lifecycle', () => {
    it('rejects start() when dispose() happens before the offer arrives', async () => {
      const { b } = createLoopbackSignaling();
      const joiner = new Peer({ role: 'joiner', signaling: b });
      peers = [joiner];

      const startPromise = joiner.start();
      // Let _startJoiner install the onOffer listener + _pendingStartReject.
      await Promise.resolve();
      joiner.dispose();

      await expect(startPromise).rejects.toThrow(/closed before start/);
      expect(joiner.state).toBe(PEER_STATES.CLOSED);
    });

    it('latches the first incoming offer before async answer work finishes', async () => {
      const OriginalRTCPeerConnection = globalThis.RTCPeerConnection;
      const OriginalRTCSessionDescription = globalThis.RTCSessionDescription;
      const remoteDescriptionResolvers = [];
      let remoteDescriptionCount = 0;
      let offerHandler;

      class FakePeerConnection extends EventTarget {
        constructor() {
          super();
          this.signalingState = 'stable';
          this.remoteDescription = null;
          this.localDescription = null;
        }

        setRemoteDescription(description) {
          remoteDescriptionCount += 1;
          return new Promise((resolve) => {
            remoteDescriptionResolvers.push(() => {
              this.remoteDescription = description;
              this.signalingState = 'have-remote-offer';
              resolve();
            });
          });
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

        close() {
          this.signalingState = 'closed';
        }
      }

      globalThis.RTCPeerConnection = FakePeerConnection;
      globalThis.RTCSessionDescription = function RTCSessionDescription(init) {
        return init;
      };

      try {
        const sendAnswer = vi.fn(() => Promise.resolve());
        const joiner = new Peer({
          role: 'joiner',
          signaling: {
            sendOffer: vi.fn(),
            sendAnswer,
            onOffer: (callback) => {
              offerHandler = callback;
            },
            onAnswer: vi.fn(),
            sendCandidate: vi.fn(),
            onRemoteCandidate: vi.fn(),
          },
        });
        peers = [joiner];

        const startPromise = joiner.start();
        await Promise.resolve();

        offerHandler({ type: 'offer', sdp: 'first-offer' });
        offerHandler({ type: 'offer', sdp: 'second-offer' });
        await Promise.resolve();

        expect(remoteDescriptionCount).toBe(1);

        remoteDescriptionResolvers[0]();
        await expect(startPromise).resolves.toBeUndefined();
        expect(sendAnswer).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.RTCPeerConnection = OriginalRTCPeerConnection;
        globalThis.RTCSessionDescription = OriginalRTCSessionDescription;
      }
    });
  });
});

function getIceUfrag(sdp = '') {
  return /^a=ice-ufrag:(.+)$/m.exec(sdp)?.[1]?.trim() ?? null;
}

function waitForIceConnected(pc, timeoutMs = 5000) {
  if (['connected', 'completed'].includes(pc.iceConnectionState)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pc.removeEventListener('iceconnectionstatechange', onChange);
      reject(new Error('Timed out waiting for ICE connection'));
    }, timeoutMs);
    const onChange = () => {
      if (!['connected', 'completed'].includes(pc.iceConnectionState)) return;
      clearTimeout(timer);
      pc.removeEventListener('iceconnectionstatechange', onChange);
      resolve();
    };
    pc.addEventListener('iceconnectionstatechange', onChange);
  });
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`Timed out waiting for ${label}`)),
        timeoutMs,
      );
    }),
  ]);
}
