import { describe, expect, it, vi } from 'vitest';
import {
  createPairSignaling,
  createRoomSignaling,
} from '../src/signaling-channel.js';

function createSource(overrides = {}) {
  return {
    sendOffer: vi.fn(),
    sendAnswer: vi.fn(),
    onOffer: vi.fn(),
    onAnswer: vi.fn(),
    sendCandidate: vi.fn(),
    onRemoteCandidate: vi.fn(),
    ...overrides,
  };
}

describe('createPairSignaling', () => {
  it('throws a clear error when a required method is missing', () => {
    const source = createSource();
    delete source.onAnswer;

    expect(() => createPairSignaling(source)).toThrow(
      /missing method "onAnswer"/,
    );
  });

  it('forwards send methods to the wrapped source', async () => {
    const source = createSource();
    const channel = createPairSignaling(source);
    const offer = { type: 'offer', sdp: 'offer-sdp' };
    const answer = { type: 'answer', sdp: 'answer-sdp' };
    const candidate = { candidate: 'candidate', sdpMid: '0' };

    await channel.sendOffer(offer);
    await channel.sendAnswer(answer);
    await channel.sendCandidate(candidate);

    expect(source.sendOffer).toHaveBeenCalledWith(offer);
    expect(source.sendAnswer).toHaveBeenCalledWith(answer);
    expect(source.sendCandidate).toHaveBeenCalledWith(candidate);
  });

  it('returns per-listener unsubscribe functions and removes them on close', () => {
    const offerUnsubscribe = vi.fn();
    const answerUnsubscribe = vi.fn();
    const candidateUnsubscribe = vi.fn();
    const source = createSource({
      onOffer: vi.fn(() => offerUnsubscribe),
      onAnswer: vi.fn(() => answerUnsubscribe),
      onRemoteCandidate: vi.fn(() => candidateUnsubscribe),
    });
    const channel = createPairSignaling(source);

    const stopOffer = channel.onOffer(() => {});
    channel.onAnswer(() => {});
    channel.onRemoteCandidate(() => {});

    stopOffer();
    stopOffer();
    channel.close();
    channel.close();

    expect(offerUnsubscribe).toHaveBeenCalledTimes(1);
    expect(answerUnsubscribe).toHaveBeenCalledTimes(1);
    expect(candidateUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('stops delivering callbacks after per-listener unsubscribe', () => {
    let offerCallback;
    const source = createSource({
      onOffer: vi.fn((callback) => {
        offerCallback = callback;
      }),
    });
    const channel = createPairSignaling(source);
    const onOffer = vi.fn();

    const unsubscribe = channel.onOffer(onOffer);
    offerCallback({ type: 'offer', sdp: 'first' });
    unsubscribe();
    offerCallback({ type: 'offer', sdp: 'second' });

    expect(onOffer).toHaveBeenCalledTimes(1);
    expect(onOffer).toHaveBeenCalledWith({ type: 'offer', sdp: 'first' });
  });

  it('stops delivering callbacks after close even without provider unsubscribe', () => {
    let offerCallback;
    const source = createSource({
      onOffer: vi.fn((callback) => {
        offerCallback = callback;
      }),
    });
    const channel = createPairSignaling(source);
    const onOffer = vi.fn();

    channel.onOffer(onOffer);
    channel.close();
    offerCallback({ type: 'offer', sdp: 'after-close' });

    expect(onOffer).not.toHaveBeenCalled();
  });

  it('normalizes listener methods that return nothing', () => {
    const source = createSource({
      onOffer: vi.fn(() => undefined),
    });
    const channel = createPairSignaling(source);

    const unsubscribe = channel.onOffer(() => {});

    expect(() => unsubscribe()).not.toThrow();
  });

  it('prevents new subscriptions after close', () => {
    const source = createSource();
    const channel = createPairSignaling(source);

    channel.close();

    expect(() => channel.onOffer(() => {})).toThrow(/after close/);
  });

  it('attempts every active cleanup when one unsubscribe throws on close', () => {
    const error = new Error('unsubscribe failed');
    const firstUnsubscribe = vi.fn(() => {
      throw error;
    });
    const secondUnsubscribe = vi.fn();
    const source = createSource({
      onOffer: vi.fn(() => firstUnsubscribe),
      onAnswer: vi.fn(() => secondUnsubscribe),
    });
    const channel = createPairSignaling(source);

    channel.onOffer(() => {});
    channel.onAnswer(() => {});

    expect(() => channel.close()).toThrow(error);
    expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
    expect(secondUnsubscribe).toHaveBeenCalledTimes(1);
    expect(() => channel.close()).not.toThrow();
  });

  it('rethrows falsy cleanup errors from close', () => {
    const secondUnsubscribe = vi.fn();
    const source = createSource({
      onOffer: vi.fn(() => () => {
        throw 0;
      }),
      onAnswer: vi.fn(() => secondUnsubscribe),
    });
    const channel = createPairSignaling(source);

    channel.onOffer(() => {});
    channel.onAnswer(() => {});

    try {
      channel.close();
      throw new Error('Expected close() to throw');
    } catch (error) {
      expect(error).toBe(0);
    }
    expect(secondUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('rejects listener methods that return invalid cleanup values', () => {
    const source = createSource({
      onOffer: vi.fn(() => ({ unsubscribe: vi.fn() })),
    });
    const channel = createPairSignaling(source);

    expect(() => channel.onOffer(() => {})).toThrow(/unsubscribe function/);
  });
});

function createRoomSource(overrides = {}) {
  return {
    join: vi.fn(),
    leave: vi.fn(),
    onPeers: vi.fn(),
    createPeerSignaling: vi.fn(() => createSource()),
    ...overrides,
  };
}

describe('createRoomSignaling', () => {
  it('throws a clear error when a required room method is missing', () => {
    const source = createRoomSource();
    delete source.createPeerSignaling;

    expect(() => createRoomSignaling(source)).toThrow(
      /missing method "createPeerSignaling"/,
    );
  });

  it('forwards join and leave to the wrapped source', async () => {
    const source = createRoomSource();
    const signaling = createRoomSignaling(source);

    await signaling.join('peer-a');
    await signaling.leave('peer-a');

    expect(source.join).toHaveBeenCalledWith('peer-a');
    expect(source.leave).toHaveBeenCalledWith('peer-a');
  });

  it('normalizes onPeers unsubscribe behavior and stops callbacks after close', () => {
    let peersCallback;
    const unsubscribe = vi.fn();
    const source = createRoomSource({
      onPeers: vi.fn((callback) => {
        peersCallback = callback;
        return unsubscribe;
      }),
    });
    const signaling = createRoomSignaling(source);
    const onPeers = vi.fn();

    signaling.onPeers(onPeers);
    peersCallback(['peer-a']);
    signaling.close();
    signaling.close();
    peersCallback(['peer-b']);

    expect(onPeers).toHaveBeenCalledTimes(1);
    expect(onPeers).toHaveBeenCalledWith(['peer-a']);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('wraps pair signaling sources with createPairSignaling semantics', async () => {
    const pairSource = createSource();
    const source = createRoomSource({
      createPeerSignaling: vi.fn(() => pairSource),
    });
    const signaling = createRoomSignaling(source);
    const pair = signaling.createPeerSignaling({
      localPeerId: 'peer-a',
      remotePeerId: 'peer-b',
    });
    const offer = { type: 'offer', sdp: 'offer-sdp' };

    await pair.sendOffer(offer);

    expect(source.createPeerSignaling).toHaveBeenCalledWith({
      localPeerId: 'peer-a',
      remotePeerId: 'peer-b',
    });
    expect(pairSource.sendOffer).toHaveBeenCalledWith(offer);
    expect(() => pair.onOffer(() => {})).not.toThrow();
  });

  it('closes active pair signaling wrappers when the room signaling closes', () => {
    const pairUnsubscribe = vi.fn();
    const pairSource = createSource({
      onOffer: vi.fn(() => pairUnsubscribe),
    });
    const source = createRoomSource({
      createPeerSignaling: vi.fn(() => pairSource),
    });
    const signaling = createRoomSignaling(source);
    const pair = signaling.createPeerSignaling({
      localPeerId: 'peer-a',
      remotePeerId: 'peer-b',
    });

    pair.onOffer(() => {});
    signaling.close();

    expect(pairUnsubscribe).toHaveBeenCalledTimes(1);
    expect(() => signaling.createPeerSignaling({
      localPeerId: 'peer-a',
      remotePeerId: 'peer-c',
    })).toThrow(/after close/);
  });
});
