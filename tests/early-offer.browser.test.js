import { afterEach, describe, expect, it, vi } from 'vitest';
import { Peer } from '../src/peer.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Deliberately drops messages when nobody is listening, like HangVidU's adapter.
function unbufferedPair() {
  const listeners = [new Map(), new Map()];
  const endpoints = listeners.map((own, index) => {
    const other = listeners[1 - index];
    const endpoint = {};
    for (const [send, subscribe] of [
      ['sendOffer', 'onOffer'],
      ['sendAnswer', 'onAnswer'],
      ['sendCandidate', 'onRemoteCandidate'],
    ]) {
      own.set(subscribe, new Set());
      endpoint[send] = vi.fn((message) => {
        for (const callback of other.get(subscribe)) callback(message);
      });
      endpoint[subscribe] = (callback) => {
        own.get(subscribe).add(callback);
        return () => own.get(subscribe).delete(callback);
      };
    }
    return endpoint;
  });
  return { endpoints, listeners };
}

const credentials = { iceServers: [{ urls: 'stun:127.0.0.1:9' }] };
let peers = [];
afterEach(() => {
  peers.forEach((peer) => peer.dispose());
  peers = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('early offer during credential loading', () => {
  it('retains the offer and trickled ICE until credentials resolve, then connects', async () => {
    const {
      endpoints: [a, b],
    } = unbufferedPair();
    const pending = deferred();
    const addedCandidates = vi.spyOn(
      RTCPeerConnection.prototype,
      'addIceCandidate',
    );
    const provider = vi.fn(() => pending.promise);
    const initiator = new Peer({
      role: 'initiator',
      signaling: a,
      dataChannel: true,
      rtcConfig: { iceServers: [] },
    });
    const joiner = new Peer({
      role: 'joiner',
      signaling: b,
      iceServersProvider: provider,
    });
    peers = [initiator, joiner];
    const started = joiner.start({
      startTimeoutMs: 3000,
      connectedTimeoutMs: 3000,
    });
    // Attach rejection handling immediately, including on the intentionally failing baseline.
    const outcome = started.then(
      () => null,
      (error) => error,
    );
    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
    await initiator.start();
    await vi.waitFor(() => expect(a.sendCandidate).toHaveBeenCalled());
    expect(a.sendOffer).toHaveBeenCalledOnce();
    expect(joiner.pc).toBeNull();
    expect(b.sendAnswer).not.toHaveBeenCalled();
    // A real, valid configuration without any external server dependency.
    pending.resolve(credentials);
    expect(await outcome).toBeNull();
    await vi.waitFor(() => expect(initiator.state).toBe('connected'));
    expect(joiner.state).toBe('connected');
    expect(b.sendAnswer).toHaveBeenCalledOnce();
    // Assert delivery itself, not merely connectivity via peer-reflexive ICE.
    expect(joiner.pc.remoteDescription.type).toBe('offer');
    for (const [candidate] of a.sendCandidate.mock.calls) {
      expect(addedCandidates).toHaveBeenCalledWith(
        expect.objectContaining({ candidate: candidate.candidate }),
      );
    }
  }, 10000);

  it.each(['abort', 'dispose', 'timeout', 'provider failure'])(
    'cleans up early subscriptions on %s without late negotiation',
    async (mode) => {
      const {
        endpoints: [a, b],
        listeners,
      } = unbufferedPair();
      const pending = deferred();
      let rejectProvider;
      const providerCalled = deferred();
      const provider = vi.fn(() => {
        providerCalled.resolve();
        return mode === 'provider failure'
          ? new Promise((_, reject) => {
              rejectProvider = reject;
            })
          : pending.promise;
      });
      if (mode === 'timeout') vi.useFakeTimers();
      const controller = new AbortController();
      const peer = new Peer({
        role: 'joiner',
        signaling: b,
        iceServersProvider: provider,
      });
      peers = [peer];
      const outcome = peer
        .start({
          signal: controller.signal,
          startTimeoutMs: mode === 'timeout' ? 100 : 3000,
        })
        .then(
          () => null,
          (error) => error,
        );
      await providerCalled.promise;
      expect(provider).toHaveBeenCalledOnce();
      expect(listeners[1].get('onOffer').size).toBe(1);
      expect(listeners[1].get('onRemoteCandidate').size).toBe(1);
      a.sendOffer({ type: 'offer', sdp: 'must never be processed' });
      a.sendCandidate({ candidate: 'must never be processed' });
      if (mode === 'timeout') await vi.advanceTimersByTimeAsync(100);
      if (mode === 'abort') controller.abort();
      if (mode === 'dispose') peer.dispose();
      if (mode === 'provider failure')
        rejectProvider(new Error('credentials unavailable'));
      expect(await outcome).toBeInstanceOf(Error);
      vi.useRealTimers();
      expect(listeners[1].get('onOffer').size).toBe(0);
      expect(listeners[1].get('onRemoteCandidate').size).toBe(0);
      pending.resolve(credentials);
      await new Promise((resolve) => setTimeout(resolve, 0));
      a.sendOffer({ type: 'offer', sdp: 'late offer' });
      expect(peer.pc).toBeNull();
      expect(b.sendAnswer).not.toHaveBeenCalled();
    },
  );
});
