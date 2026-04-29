import { describe, expect, it, vi, beforeEach } from 'vitest';

const sessionMocks = vi.hoisted(() => ({
  startP2PSession: vi.fn(),
  joinP2PSession: vi.fn(),
}));

vi.mock('../src/session.js', () => sessionMocks);

import { P2PRoom, joinP2PRoom, watchP2PRoom } from '../src/room.js';

function createPairSignaling() {
  return {
    sendOffer: vi.fn(),
    sendAnswer: vi.fn(),
    onOffer: vi.fn(),
    onAnswer: vi.fn(),
    sendCandidate: vi.fn(),
    onRemoteCandidate: vi.fn(),
  };
}

function createTestRoomSignaling() {
  let onPeers = null;

  return {
    join: vi.fn(),
    leave: vi.fn(),
    close: vi.fn(),
    onPeers: vi.fn((callback) => {
      onPeers = callback;
      return () => {
        onPeers = null;
      };
    }),
    createPeerSignaling: vi.fn(() => createPairSignaling()),
    emitPeers(peerIds) {
      onPeers?.(peerIds);
    },
  };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createResolvedSession() {
  return {
    close: vi.fn(),
    dataChannel: null,
  };
}

describe('P2PRoom', () => {
  beforeEach(() => {
    sessionMocks.startP2PSession.mockReset();
    sessionMocks.joinP2PSession.mockReset();
  });

  it('watches peers without joining presence or connecting to peers', async () => {
    sessionMocks.startP2PSession.mockResolvedValue(createResolvedSession());
    const signaling = createTestRoomSignaling();

    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
    });

    signaling.emitPeers(['b']);
    await flushAsyncWork();

    expect(signaling.onPeers).toHaveBeenCalledOnce();
    expect(signaling.join).not.toHaveBeenCalled();
    expect(signaling.createPeerSignaling).not.toHaveBeenCalled();
    expect(sessionMocks.startP2PSession).not.toHaveBeenCalled();

    room.close();
    room.close();

    expect(signaling.leave).not.toHaveBeenCalled();
    expect(signaling.close).toHaveBeenCalledOnce();
  });

  it('joins from watch mode and connects to existing peers', async () => {
    sessionMocks.startP2PSession.mockResolvedValue(createResolvedSession());
    const signaling = createTestRoomSignaling();
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
    });

    signaling.emitPeers(['b']);
    await room.join();
    await flushAsyncWork();

    expect(signaling.join).toHaveBeenCalledWith('a');
    expect(signaling.createPeerSignaling).toHaveBeenCalledWith({
      localPeerId: 'a',
      remotePeerId: 'b',
    });
    expect(sessionMocks.startP2PSession).toHaveBeenCalledOnce();

    room.close();
  });

  it('leaves active presence without closing the room subscription', async () => {
    const session = createResolvedSession();
    sessionMocks.startP2PSession.mockResolvedValue(session);
    const signaling = createTestRoomSignaling();
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
    });

    signaling.emitPeers(['b']);
    await room.join();
    await flushAsyncWork();

    await room.leave();
    signaling.emitPeers(['c']);
    await flushAsyncWork();

    expect(signaling.leave).toHaveBeenCalledWith('a');
    expect(session.close).toHaveBeenCalled();
    expect(signaling.close).not.toHaveBeenCalled();
    expect(sessionMocks.startP2PSession).toHaveBeenCalledOnce();

    await room.join();
    await flushAsyncWork();

    expect(signaling.join).toHaveBeenCalledTimes(2);
    expect(signaling.createPeerSignaling).toHaveBeenCalledTimes(2);

    room.close();
  });

  it('emits full while watching and rejects join when maxPeers is reached', async () => {
    const signaling = createTestRoomSignaling();
    const full = [];
    const room = await watchP2PRoom({
      signaling,
      peerId: 'c',
      maxPeers: 2,
      onFull: (detail) => full.push(detail),
    });

    signaling.emitPeers(['a', 'b']);
    await flushAsyncWork();

    expect(full).toEqual([{ peerIds: ['a', 'b'], maxPeers: 2 }]);

    await expect(room.join()).rejects.toThrow('room is full');

    expect(full).toEqual([
      { peerIds: ['a', 'b'], maxPeers: 2 },
      { peerIds: ['a', 'b'], maxPeers: 2 },
    ]);
    expect(signaling.join).not.toHaveBeenCalled();
    expect(signaling.createPeerSignaling).not.toHaveBeenCalled();

    room.close();
  });

  it('allows joining when maxPeers is reached but local peer is present', async () => {
    sessionMocks.startP2PSession.mockResolvedValue(createResolvedSession());
    const signaling = createTestRoomSignaling();
    const full = [];
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
      maxPeers: 2,
      onFull: (detail) => full.push(detail),
    });

    signaling.emitPeers(['a', 'b']);
    await room.join();
    await flushAsyncWork();

    expect(full).toHaveLength(0);
    expect(signaling.join).toHaveBeenCalledWith('a');
    expect(sessionMocks.startP2PSession).toHaveBeenCalledOnce();

    room.close();
  });

  it('leaves and rejects join when the room fills during join', async () => {
    const join = createDeferred();
    const signaling = createTestRoomSignaling();
    signaling.join.mockReturnValue(join.promise);
    const full = [];
    const room = await watchP2PRoom({
      signaling,
      peerId: 'c',
      maxPeers: 2,
      onFull: (detail) => full.push(detail),
    });

    signaling.emitPeers(['a']);
    const joinPromise = room.join();
    signaling.emitPeers(['a', 'b']);
    await flushAsyncWork();

    expect(full).toEqual([{ peerIds: ['a', 'b'], maxPeers: 2 }]);

    join.resolve();

    await expect(joinPromise).rejects.toThrow('room is full');
    expect(signaling.leave).toHaveBeenCalledWith('c');
    expect(signaling.createPeerSignaling).not.toHaveBeenCalled();
    expect(full).toEqual([
      { peerIds: ['a', 'b'], maxPeers: 2 },
      { peerIds: ['a', 'b'], maxPeers: 2 },
    ]);

    room.close();
  });

  it('reports startup failures without emitting peerLeft', async () => {
    const startupError = new Error('startup failed');
    sessionMocks.startP2PSession.mockRejectedValue(startupError);
    const signaling = createTestRoomSignaling();
    const errors = [];
    const peerLeft = [];

    const room = new P2PRoom({
      signaling,
      peerId: 'a',
      onPeerLeft: (detail) => peerLeft.push(detail),
    });
    room.on('error', (detail) => errors.push(detail));

    await room.ready;
    signaling.emitPeers(['a', 'b']);
    await flushAsyncWork();

    expect(sessionMocks.startP2PSession).toHaveBeenCalledOnce();
    expect(errors).toEqual([{ peerId: 'b', error: startupError }]);
    expect(peerLeft).toHaveLength(0);

    room.close();
  });

  it('rejects joinP2PRoom when the signal aborts during room join', async () => {
    const join = createDeferred();
    const signaling = createTestRoomSignaling();
    signaling.join.mockReturnValue(join.promise);
    const controller = new AbortController();

    const roomPromise = joinP2PRoom({
      signaling,
      peerId: 'a',
      signal: controller.signal,
    });
    await flushAsyncWork();

    controller.abort();

    await expect(roomPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(signaling.leave).toHaveBeenCalledWith('a');

    join.resolve();
    await flushAsyncWork();
  });
});
