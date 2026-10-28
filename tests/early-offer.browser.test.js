import { afterEach, describe, expect, it, vi } from 'vitest';
import { Peer } from '../src/peer.js';
import { joinP2PSession } from '../src/session.js';

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

describe('initial negotiation failure', () => {
  it.each(['buffered Peer', 'subscribed Peer', 'buffered session'])(
    'stops queued distinct offers after the first answer fails (%s)',
    async (mode) => {
      const raw = new RTCPeerConnection({ iceServers: [] });
      peers.push({ dispose: () => raw.close() });
      raw.createDataChannel('probe');
      const offer = await raw.createOffer();
      await raw.setLocalDescription(offer);
      const {
        endpoints: [a, b],
      } = unbufferedPair();
      const pending = deferred();
      const providerCalled = deferred();
      const failure = new Error('first answer failed');
      b.sendAnswer.mockRejectedValueOnce(failure);
      const handled = vi.spyOn(Peer.prototype, '_handleOffer');
      const options = {
        role: 'joiner',
        signaling: b,
        rtcConfig: { iceServers: [] },
        iceServersProvider: () => {
          providerCalled.resolve();
          return pending.promise;
        },
      };
      const direct = mode === 'buffered session' ? null : new Peer(options);
      if (direct) peers.push(direct);
      const outcome = (direct ? direct.start() : joinP2PSession(options)).then(
        () => null,
        (error) => error,
      );
      await providerCalled.promise;
      if (mode === 'subscribed Peer') {
        pending.resolve(credentials);
        await vi.waitFor(() => expect(direct.pc).not.toBeNull());
      }
      a.sendOffer(offer);
      // A distinct valid SDP bypasses identical-offer deduplication.
      a.sendOffer({
        type: offer.type,
        sdp: offer.sdp + 'a=x-regression:second\r\n',
      });
      pending.resolve(credentials);
      expect(await outcome).toBe(failure);
      const peer = direct ?? handled.mock.contexts[0];
      await peer._offerChain;
      expect(b.sendAnswer).toHaveBeenCalledOnce();
      expect(handled).toHaveBeenCalledOnce();
      if (direct) expect(direct.state).toBe('failed');
    },
  );
});

const BUFFER_MESSAGES = 256;
const BUFFER_BYTES = 1024 * 1024;
function sizedPayload(key, bytes) {
  return { [key]: 'x'.repeat(bytes - JSON.stringify({ [key]: '' }).length) };
}

// Both budgets apply to all early signal types together, independent of timeout.
describe.each([0, 10000])(
  'initial signaling budget (timeout %i)',
  (startTimeoutMs) => {
    async function pendingJoiner() {
      const pair = unbufferedPair();
      const [sender, signaling] = pair.endpoints;
      const pending = deferred();
      const entered = deferred();
      let signal;
      const peer = new Peer({
        role: 'joiner',
        signaling,
        iceServersProvider: (context) => {
          signal = context.signal;
          entered.resolve();
          return pending.promise;
        },
      });
      peers.push(peer);
      const outcome = peer.start({ startTimeoutMs }).then(
        () => null,
        (error) => error,
      );
      await entered.promise;
      return { ...pair, sender, peer, pending, outcome, signal };
    }

    async function expectOverflow(context) {
      expect(context.peer.state).toBe('closed');
      const error = await context.outcome;
      expect(error?.code).toBe('ERR_P2P_INITIAL_SIGNAL_BUFFER_LIMIT');
      expect(context.signal.aborted).toBe(true);
      for (const handlers of context.listeners[1].values())
        expect(handlers.size).toBe(0);
      context.pending.resolve(credentials);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(context.peer.pc).toBeNull();
      expect(context.endpoints[1].sendAnswer).not.toHaveBeenCalled();
    }

    it.each(['offers', 'candidates', 'mixed'])(
      'accepts the count boundary then rejects another signal (%s)',
      async (kind) => {
        const context = await pendingJoiner();
        for (let index = 0; index < BUFFER_MESSAGES; index++) {
          if (kind === 'candidates' || (kind === 'mixed' && index % 2))
            context.sender.sendCandidate({ candidate: 'small' });
          else context.sender.sendOffer({ type: 'offer', sdp: 'small' });
        }
        expect(context.peer.state).toBe('connecting');
        context.sender.sendCandidate({ candidate: 'one too many' });
        await expectOverflow(context);
      },
    );

    it('accepts the shared byte boundary then rejects another signal', async () => {
      const context = await pendingJoiner();
      context.sender.sendOffer(sizedPayload('sdp', BUFFER_BYTES / 2));
      context.sender.sendCandidate(sizedPayload('candidate', BUFFER_BYTES / 2));
      expect(context.peer.state).toBe('connecting');
      context.sender.sendOffer({ sdp: 'over budget' });
      await expectOverflow(context);
    });

    it.each(['sdp', 'candidate'])(
      'rejects a single oversized %s payload',
      async (key) => {
        const context = await pendingJoiner();
        const send =
          key === 'sdp'
            ? context.sender.sendOffer
            : context.sender.sendCandidate;
        send(sizedPayload(key, BUFFER_BYTES + 1));
        await expectOverflow(context);
      },
    );

    it('counts UTF-8 bytes rather than string characters', async () => {
      const context = await pendingJoiner();
      context.sender.sendOffer({ sdp: 'é'.repeat(BUFFER_BYTES / 2) });
      await expectOverflow(context);
    });
  },
);

it('cleans up overflow during synchronous subscription replay', async () => {
  const {
    endpoints: [, signaling],
  } = unbufferedPair();
  const unsubscribe = vi.fn();
  signaling.onOffer = (callback) => {
    for (let index = 0; index <= BUFFER_MESSAGES; index++)
      callback({ sdp: 'small' });
    return unsubscribe;
  };
  const candidates = vi.spyOn(signaling, 'onRemoteCandidate');
  const provider = vi.fn();
  const peer = new Peer({
    role: 'joiner',
    signaling,
    iceServersProvider: provider,
  });
  peers.push(peer);
  const error = await peer.start().catch((error) => error);
  expect(error.code).toBe('ERR_P2P_INITIAL_SIGNAL_BUFFER_LIMIT');
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(candidates).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
  expect(peer.pc).toBeNull();
});
