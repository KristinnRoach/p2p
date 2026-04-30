import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

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

function createTestRoomSignaling(overrides = {}) {
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
    ...overrides,
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

function createFakeStream() {
  const track = { stop: vi.fn() };
  return {
    getTracks: vi.fn(() => [track]),
    track,
  };
}

describe('P2PRoom', () => {
  beforeEach(() => {
    sessionMocks.startP2PSession.mockReset();
    sessionMocks.joinP2PSession.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('refreshes provider-owned presence while joined', async () => {
    vi.useFakeTimers();
    sessionMocks.startP2PSession.mockResolvedValue(createResolvedSession());
    const refreshPresence = vi.fn();
    const signaling = createTestRoomSignaling({ refreshPresence });
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
    });

    await room.join();
    await vi.advanceTimersByTimeAsync(5000);

    expect(refreshPresence).toHaveBeenCalledWith('a');

    await room.leave();
    await vi.advanceTimersByTimeAsync(5000);

    expect(refreshPresence).toHaveBeenCalledTimes(1);

    room.close();
  });

  it('emits synchronous presence refresh failures through the room error event', async () => {
    vi.useFakeTimers();
    sessionMocks.startP2PSession.mockResolvedValue(createResolvedSession());
    const refreshError = new Error('refresh failed');
    const signaling = createTestRoomSignaling({
      refreshPresence: vi.fn(() => {
        throw refreshError;
      }),
    });
    const errors = [];
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
    });
    room.on('error', (detail) => errors.push(detail));

    await room.join();
    await vi.advanceTimersByTimeAsync(5000);

    expect(errors).toEqual([{ peerId: 'a', error: refreshError }]);

    room.close();
  });

  it('best-effort leaves active presence on pagehide', async () => {
    sessionMocks.startP2PSession.mockResolvedValue(createResolvedSession());
    const signaling = createTestRoomSignaling();
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
    });

    await room.join();
    window.dispatchEvent(new Event('pagehide'));
    await flushAsyncWork();

    expect(signaling.leave).toHaveBeenCalledWith('a');

    room.close();
  });

  it('does not leave presence when pagehide stores the page in bfcache', async () => {
    sessionMocks.startP2PSession.mockResolvedValue(createResolvedSession());
    const signaling = createTestRoomSignaling();
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
    });
    const event = new Event('pagehide');
    Object.defineProperty(event, 'persisted', { value: true });

    await room.join();
    window.dispatchEvent(event);
    await flushAsyncWork();

    expect(signaling.leave).not.toHaveBeenCalled();

    room.close();
  });

  it('supports signaling and media factories with room-owned media cleanup', async () => {
    sessionMocks.startP2PSession.mockResolvedValue(createResolvedSession());
    const signaling = createTestRoomSignaling();
    const stream = createFakeStream();
    const localStreams = [];
    const createSignaling = vi.fn(() => signaling);
    const getLocalStream = vi.fn(() => stream);

    const room = await watchP2PRoom({
      roomId: 'room-a',
      createSignaling,
      getLocalStream,
      peerId: 'a',
      onLocalStream: ({ stream }) => localStreams.push(stream),
    });

    expect(createSignaling).toHaveBeenCalledOnce();
    expect(createSignaling).toHaveBeenCalledWith({ roomId: 'room-a' });
    expect(getLocalStream).not.toHaveBeenCalled();

    signaling.emitPeers(['b']);
    await room.join();
    await flushAsyncWork();

    expect(getLocalStream).toHaveBeenCalledOnce();
    expect(localStreams).toEqual([stream]);
    expect(sessionMocks.startP2PSession).toHaveBeenCalledWith(
      expect.objectContaining({ localStream: stream }),
    );

    await room.leave();

    expect(stream.track.stop).toHaveBeenCalledOnce();

    await room.join();

    expect(getLocalStream).toHaveBeenCalledTimes(2);

    room.close();
  });

  it('waits for factory signaling when joining before ready resolves', async () => {
    sessionMocks.startP2PSession.mockResolvedValue(createResolvedSession());
    const signaling = createTestRoomSignaling();
    const createSignaling = vi.fn(() => Promise.resolve(signaling));

    const room = new P2PRoom({
      roomId: 'room-a',
      createSignaling,
      peerId: 'a',
      autoJoin: false,
    });

    await room.join();

    expect(createSignaling).toHaveBeenCalledOnce();
    expect(signaling.join).toHaveBeenCalledWith('a');

    room.close();
  });

  it('retries factory signaling after a failed lazy join', async () => {
    const signaling = createTestRoomSignaling();
    const createSignaling = vi
      .fn()
      .mockRejectedValueOnce(new Error('signaling failed'))
      .mockResolvedValueOnce(signaling);
    const room = new P2PRoom({
      roomId: 'room-a',
      createSignaling,
      peerId: 'a',
      autoJoin: false,
    });

    await expect(room.ready).rejects.toThrow('signaling failed');
    await room.join();

    expect(createSignaling).toHaveBeenCalledTimes(2);
    expect(signaling.join).toHaveBeenCalledWith('a');

    room.close();
  });

  it('does not request factory media when the room is full while watching', async () => {
    const signaling = createTestRoomSignaling();
    const getLocalStream = vi.fn(() => createFakeStream());
    const room = await watchP2PRoom({
      roomId: 'room-a',
      createSignaling: () => signaling,
      getLocalStream,
      peerId: 'c',
      maxPeers: 2,
    });

    signaling.emitPeers(['a', 'b']);

    await expect(room.join()).rejects.toMatchObject({
      name: 'RoomFullError',
      message: 'P2PRoom.join: room is full',
    });

    expect(getLocalStream).not.toHaveBeenCalled();

    room.close();
  });

  it('stops factory-created media when room join fails', async () => {
    const signaling = createTestRoomSignaling();
    const stream = createFakeStream();
    signaling.join.mockRejectedValue(new Error('join failed'));

    const room = await watchP2PRoom({
      roomId: 'room-a',
      createSignaling: () => signaling,
      getLocalStream: () => stream,
      peerId: 'a',
    });

    await expect(room.join()).rejects.toThrow('join failed');

    expect(stream.track.stop).toHaveBeenCalledOnce();

    room.close();
  });

  it('rejects ambiguous room resource inputs', () => {
    const signaling = createTestRoomSignaling();

    expect(
      () =>
        new P2PRoom({
          signaling,
          createSignaling: () => signaling,
          roomId: 'room-a',
          peerId: 'a',
        }),
    ).toThrow('pass either signaling or createSignaling');

    expect(
      () =>
        new P2PRoom({
          signaling,
          localStream: createFakeStream(),
          getLocalStream: () => createFakeStream(),
          peerId: 'a',
        }),
    ).toThrow('pass either localStream or getLocalStream');
  });

  it('requires roomId when using a signaling factory', () => {
    expect(
      () =>
        new P2PRoom({
          createSignaling: () => createTestRoomSignaling(),
          peerId: 'a',
        }),
    ).toThrow('roomId is required with createSignaling');
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

  it('rolls back local leave state when signaling leave rejects', async () => {
    const session = createResolvedSession();
    sessionMocks.startP2PSession.mockResolvedValue(session);
    const signaling = createTestRoomSignaling();
    const leaveError = new Error('leave failed');
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
    });

    signaling.emitPeers(['b']);
    await room.join();
    await flushAsyncWork();
    signaling.leave.mockRejectedValueOnce(leaveError);

    await expect(room.leave()).rejects.toThrow('leave failed');

    expect(room._state).toBe('watching');
    expect(room._joinStarted).toBe(false);
    expect(room._joined).toBe(false);
    expect(session.close).toHaveBeenCalled();

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

  it('still rejects with room full when cleanup leave fails during join', async () => {
    const join = createDeferred();
    const signaling = createTestRoomSignaling();
    const stream = createFakeStream();
    signaling.join.mockReturnValue(join.promise);
    signaling.leave.mockRejectedValue(new Error('leave failed'));
    const room = await watchP2PRoom({
      signaling,
      getLocalStream: () => stream,
      peerId: 'c',
      maxPeers: 2,
    });

    signaling.emitPeers(['a']);
    const joinPromise = room.join();
    signaling.emitPeers(['a', 'b']);
    await flushAsyncWork();

    join.resolve();

    await expect(joinPromise).rejects.toMatchObject({
      name: 'RoomFullError',
      message: 'P2PRoom.join: room is full',
    });
    expect(signaling.leave).toHaveBeenCalledWith('c');
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(room._state).toBe('watching');
    expect(room._joinStarted).toBe(false);
    expect(room._joined).toBe(false);

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

  it('rolls back room presence when the signal aborts after room join', async () => {
    const signaling = createTestRoomSignaling();
    const controller = new AbortController();
    signaling.join.mockImplementation(() => {
      controller.abort();
    });
    signaling.leave.mockRejectedValue(new Error('leave failed'));
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
      signal: controller.signal,
    });

    await expect(room.join()).rejects.toMatchObject({ name: 'AbortError' });

    expect(signaling.join).toHaveBeenCalledWith('a');
    expect(signaling.leave).toHaveBeenCalledWith('a');
    expect(room._joinStarted).toBe(false);
    expect(room._joined).toBe(false);
    expect(room._state).toBe('closed');

    room.close();
  });

  it('cleans up owned media when aborted after local stream resolves', async () => {
    const signaling = createTestRoomSignaling();
    const stream = createFakeStream();
    const controller = new AbortController();
    const room = await watchP2PRoom({
      signaling,
      getLocalStream: () => stream,
      peerId: 'a',
      signal: controller.signal,
      onLocalStream: () => controller.abort(),
    });

    await expect(room.join()).rejects.toMatchObject({ name: 'AbortError' });

    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(room._state).toBe('closed');
    expect(room._joinStarted).toBe(false);
    expect(signaling.join).not.toHaveBeenCalled();

    room.close();
  });
});
