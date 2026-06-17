import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const sessionMocks = vi.hoisted(() => ({
  startP2PSession: vi.fn(),
  joinP2PSession: vi.fn(),
}));

vi.mock('../src/session.js', () => sessionMocks);

import {
  LocalStreamError,
  P2PRoom,
  RoomFullError,
  isLocalStreamError,
  isRoomFullError,
  joinP2PRoom,
  watchP2PRoom,
} from '../src/room.js';
import { setLogger } from '../src/logger.js';

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
    cleanupSignaling: vi.fn(),
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
    setLogger(() => {});
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
    expect(signaling.cleanupSignaling).toHaveBeenCalledOnce();
  });

  it('joins from watch mode and connects to existing peers', async () => {
    sessionMocks.startP2PSession.mockResolvedValue(createResolvedSession());
    const signaling = createTestRoomSignaling();
    const stateChanges = [];
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
      onStateChange: (detail) => stateChanges.push(detail),
    });

    expect(room.state).toBe('watching');
    signaling.emitPeers(['b']);
    await room.join();
    await flushAsyncWork();

    expect(room.state).toBe('joined');
    expect(stateChanges).toEqual([
      { previous: 'watching', state: 'joining' },
      { previous: 'joining', state: 'joined' },
    ]);
    expect(signaling.join).toHaveBeenCalledWith('a');
    expect(signaling.createPeerSignaling).toHaveBeenCalledWith({
      localPeerId: 'a',
      remotePeerId: 'b',
    });
    expect(sessionMocks.startP2PSession).toHaveBeenCalledOnce();

    await room.leave();

    expect(room.state).toBe('watching');
    expect(stateChanges).toEqual([
      { previous: 'watching', state: 'joining' },
      { previous: 'joining', state: 'joined' },
      { previous: 'joined', state: 'leaving' },
      { previous: 'leaving', state: 'watching' },
    ]);

    room.close();

    expect(room.state).toBe('closed');
    expect(stateChanges).toEqual([
      { previous: 'watching', state: 'joining' },
      { previous: 'joining', state: 'joined' },
      { previous: 'joined', state: 'leaving' },
      { previous: 'leaving', state: 'watching' },
      { previous: 'watching', state: 'closed' },
    ]);
  });

  it('wraps getLocalStream failures with LocalStreamError', async () => {
    const signaling = createTestRoomSignaling();
    const cause = new DOMException('Permission denied', 'NotAllowedError');
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
      getLocalStream: () => {
        throw cause;
      },
    });

    try {
      await room.join();
      throw new Error('Expected join to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(LocalStreamError);
      expect(isLocalStreamError(error)).toBe(true);
      expect(error.cause).toBe(cause);
    }

    expect(signaling.join).not.toHaveBeenCalled();
    expect(room.state).toBe('watching');

    room.close();
  });

  it('exposes room members and emits membersChanged', async () => {
    const signaling = createTestRoomSignaling();
    const membersChanged = [];
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
      memberCapacity: 3,
      onMembersChanged: (detail) => membersChanged.push(detail),
    });

    signaling.emitPeers(['a', 'b']);
    await flushAsyncWork();

    expect(room.members).toEqual(['a', 'b']);
    expect(room.memberCount).toBe(2);
    expect(room.memberCapacity).toBe(3);
    expect(room.isFull).toBe(false);
    expect(membersChanged).toEqual([
      {
        members: ['a', 'b'],
        memberPresence: [{ memberId: 'a' }, { memberId: 'b' }],
        memberCount: 2,
        memberCapacity: 3,
      },
    ]);

    signaling.emitPeers(['a', 'b', 'c']);
    await flushAsyncWork();

    expect(room.members).toEqual(['a', 'b', 'c']);
    expect(room.memberCount).toBe(3);
    expect(membersChanged).toEqual([
      {
        members: ['a', 'b'],
        memberPresence: [{ memberId: 'a' }, { memberId: 'b' }],
        memberCount: 2,
        memberCapacity: 3,
      },
      {
        members: ['a', 'b', 'c'],
        memberPresence: [
          { memberId: 'a' },
          { memberId: 'b' },
          { memberId: 'c' },
        ],
        memberCount: 3,
        memberCapacity: 3,
      },
    ]);

    room.close();
  });

  it('exposes structured member presence data without changing members', async () => {
    const signaling = createTestRoomSignaling();
    const membersChanged = [];
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
      onMembersChanged: (detail) => membersChanged.push(detail),
    });

    signaling.emitPeers([
      { memberId: 'a', data: { displayName: 'Ada', muted: false } },
      { memberId: 'b', data: { displayName: 'Ben', ringing: true } },
    ]);
    await flushAsyncWork();

    expect(room.members).toEqual(['a', 'b']);
    expect(room.memberPresence).toEqual([
      { memberId: 'a', data: { displayName: 'Ada', muted: false } },
      { memberId: 'b', data: { displayName: 'Ben', ringing: true } },
    ]);
    expect(membersChanged.at(-1)).toEqual({
      members: ['a', 'b'],
      memberPresence: [
        { memberId: 'a', data: { displayName: 'Ada', muted: false } },
        { memberId: 'b', data: { displayName: 'Ben', ringing: true } },
      ],
      memberCount: 2,
      memberCapacity: Infinity,
    });

    const snapshot = room.memberPresence;
    snapshot[0].data.muted = true;
    snapshot.pop();
    expect(room.memberPresence).toEqual([
      { memberId: 'a', data: { displayName: 'Ada', muted: false } },
      { memberId: 'b', data: { displayName: 'Ben', ringing: true } },
    ]);

    room.close();
  });

  it('de-dupes duplicate presence snapshots by memberId', async () => {
    const signaling = createTestRoomSignaling();
    const logs = [];
    setLogger((...args) => logs.push(args));
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
    });

    signaling.emitPeers([
      { memberId: 'a', data: { displayName: 'Ada' } },
      { memberId: 'b', data: { displayName: 'Ben', muted: false } },
      { memberId: 'b', data: { displayName: 'Ben', muted: true } },
      'c',
      'c',
    ]);
    await flushAsyncWork();

    expect(room.members).toEqual(['a', 'b', 'c']);
    expect(room.memberPresence).toEqual([
      { memberId: 'a', data: { displayName: 'Ada' } },
      { memberId: 'b', data: { displayName: 'Ben', muted: true } },
      { memberId: 'c' },
    ]);
    expect(room.memberCount).toBe(3);
    expect(logs).toEqual([
      ['[Room] Duplicate memberId(s) in presence snapshot ignored: b, c'],
    ]);

    room.close();
  });

  it('emits membersChanged on a data-only change with unchanged membership', async () => {
    const signaling = createTestRoomSignaling();
    const membersChanged = [];
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
      onMembersChanged: (detail) => membersChanged.push(detail),
    });

    signaling.emitPeers([
      { memberId: 'a', data: { muted: false } },
      { memberId: 'b' },
    ]);
    await flushAsyncWork();
    expect(membersChanged).toHaveLength(1);

    // Same members, only 'a' presence data changes (e.g. mute toggle).
    signaling.emitPeers([
      { memberId: 'a', data: { muted: true } },
      { memberId: 'b' },
    ]);
    await flushAsyncWork();

    expect(room.members).toEqual(['a', 'b']);
    expect(membersChanged).toHaveLength(2);
    expect(membersChanged.at(-1).memberPresence).toEqual([
      { memberId: 'a', data: { muted: true } },
      { memberId: 'b' },
    ]);

    // An identical snapshot does not re-fire.
    signaling.emitPeers([
      { memberId: 'a', data: { muted: true } },
      { memberId: 'b' },
    ]);
    await flushAsyncWork();
    expect(membersChanged).toHaveLength(2);

    room.close();
  });

  it('passes initial and updated presence data to signaling', async () => {
    const signaling = createTestRoomSignaling({
      updatePresenceData: vi.fn(),
    });
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
      presenceData: { displayName: 'Ada', callState: 'ringing' },
    });

    await room.join();
    await room.setPresenceData({ displayName: 'Ada', callState: 'joined' });

    expect(signaling.join).toHaveBeenCalledWith('a', {
      displayName: 'Ada',
      callState: 'ringing',
    });
    expect(signaling.updatePresenceData).toHaveBeenCalledWith('a', {
      displayName: 'Ada',
      callState: 'joined',
    });

    room.close();
  });

  it('exposes remote member streams in room member order', async () => {
    const firstStream = createFakeStream();
    const secondStream = createFakeStream();
    const streams = [firstStream, secondStream];
    sessionMocks.startP2PSession.mockImplementation(({ onRemoteStream }) => {
      onRemoteStream({ stream: streams.shift() });
      return Promise.resolve(createResolvedSession());
    });
    const signaling = createTestRoomSignaling();
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
    });

    signaling.emitPeers(['c', 'b']);
    await room.join();
    await flushAsyncWork();

    expect(room.remoteMemberStreams).toEqual([
      { memberId: 'c', stream: firstStream },
      { memberId: 'b', stream: secondStream },
    ]);

    room.close();
  });

  it('defensively de-dupes remote member streams by memberId', async () => {
    const stream = createFakeStream();
    const signaling = createTestRoomSignaling();
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
    });

    room._memberIds = ['b', 'b'];
    room.remoteStreams.set('b', stream);

    expect(room.remoteMemberStreams).toEqual([{ memberId: 'b', stream }]);

    room.close();
  });

  it('keeps remote member stream entries stable when member order changes', async () => {
    const firstStream = createFakeStream();
    const secondStream = createFakeStream();
    const streams = [firstStream, secondStream];
    sessionMocks.startP2PSession.mockImplementation(({ onRemoteStream }) => {
      onRemoteStream({ stream: streams.shift() });
      return Promise.resolve(createResolvedSession());
    });
    const signaling = createTestRoomSignaling();
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
    });

    signaling.emitPeers(['b', 'c']);
    await room.join();
    await flushAsyncWork();

    const previousStreams = room.remoteMemberStreams;
    signaling.emitPeers(['c', 'b']);
    await flushAsyncWork();

    expect(room.remoteMemberStreams).toEqual([
      previousStreams[1],
      previousStreams[0],
    ]);
    expect(room.remoteMemberStreams[0]).toBe(previousStreams[1]);
    expect(room.remoteMemberStreams[1]).toBe(previousStreams[0]);

    room.close();
  });

  it('emits memberStreamRemoved (and peerStreamRemoved) when a member with a stream leaves', async () => {
    const stream = createFakeStream();
    sessionMocks.startP2PSession.mockImplementation(({ onRemoteStream }) => {
      onRemoteStream({ stream });
      return Promise.resolve(createResolvedSession());
    });
    const signaling = createTestRoomSignaling();
    const removed = [];
    const peerRemoved = [];
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
      onMemberStreamRemoved: (detail) => removed.push(detail),
    });
    room.on('peerStreamRemoved', (detail) => peerRemoved.push(detail));

    signaling.emitPeers(['b']);
    await room.join();
    await flushAsyncWork();

    signaling.emitPeers([]);
    await flushAsyncWork();

    expect(removed).toEqual([{ memberId: 'b', stream }]);
    expect(peerRemoved).toEqual([{ peerId: 'b', memberId: 'b', stream }]);

    room.close();
  });

  it('does not emit memberStreamRemoved for a member that never had a stream', async () => {
    sessionMocks.startP2PSession.mockResolvedValue(createResolvedSession());
    const signaling = createTestRoomSignaling();
    const removed = [];
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
      onMemberStreamRemoved: (detail) => removed.push(detail),
    });

    signaling.emitPeers(['b']);
    await room.join();
    await flushAsyncWork();

    signaling.emitPeers([]);
    await flushAsyncWork();

    expect(removed).toEqual([]);

    room.close();
  });

  it('emits alone when the last remote member leaves', async () => {
    sessionMocks.startP2PSession.mockResolvedValue(createResolvedSession());
    const signaling = createTestRoomSignaling();
    const alone = [];
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
      onAlone: (detail) => alone.push(detail),
    });

    signaling.emitPeers(['b']);
    await room.join();
    await flushAsyncWork();
    expect(alone).toEqual([]);

    signaling.emitPeers([]);
    await flushAsyncWork();

    expect(alone).toEqual([{ members: [], memberCount: 0 }]);

    room.close();
  });

  it('does not emit alone when joining an empty room', async () => {
    sessionMocks.startP2PSession.mockResolvedValue(createResolvedSession());
    const signaling = createTestRoomSignaling();
    const alone = [];
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
      onAlone: (detail) => alone.push(detail),
    });

    signaling.emitPeers([]);
    await room.join();
    await flushAsyncWork();

    expect(alone).toEqual([]);

    room.close();
  });

  it('auto-closes the room when the last remote member leaves with autoCloseWhenAlone', async () => {
    sessionMocks.startP2PSession.mockResolvedValue(createResolvedSession());
    const signaling = createTestRoomSignaling();
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
      autoCloseWhenAlone: true,
    });

    signaling.emitPeers(['b']);
    await room.join();
    await flushAsyncWork();
    expect(room.state).toBe('joined');

    signaling.emitPeers([]);
    await flushAsyncWork();

    expect(room.state).toBe('closed');
    expect(signaling.leave).toHaveBeenCalledWith('a');
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
      onError: (detail) => errors.push(detail),
    });

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

  it('suppresses async signaling cleanup failures when closed during factory setup', async () => {
    const signaling = createTestRoomSignaling({
      cleanupSignaling: vi.fn(() => Promise.reject(new Error('cleanup failed'))),
    });
    const deferred = createDeferred();
    const room = new P2PRoom({
      roomId: 'room-a',
      createSignaling: () => deferred.promise,
      peerId: 'a',
      autoJoin: false,
    });

    room.close();
    deferred.resolve(signaling);

    await expect(room.ready).rejects.toMatchObject({ name: 'AbortError' });
    await flushAsyncWork();

    expect(signaling.cleanupSignaling).toHaveBeenCalledOnce();
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
      memberCapacity: 2,
    });

    signaling.emitPeers(['a', 'b']);

    await expect(room.join()).rejects.toBeInstanceOf(RoomFullError);
    try {
      await room.join();
    } catch (error) {
      expect(isRoomFullError(error)).toBe(true);
    }

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
    expect(signaling.cleanupSignaling).not.toHaveBeenCalled();
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

  it('emits full while watching and rejects join when memberCapacity is reached', async () => {
    const signaling = createTestRoomSignaling();
    const full = [];
    const room = await watchP2PRoom({
      signaling,
      peerId: 'c',
      memberCapacity: 2,
      onFull: (detail) => full.push(detail),
    });

    signaling.emitPeers(['a', 'b']);
    await flushAsyncWork();

    expect(full).toEqual([
      {
        members: ['a', 'b'],
        memberCount: 2,
        memberCapacity: 2,
        peerIds: ['a', 'b'],
        maxPeers: 2,
      },
    ]);

    await expect(room.join()).rejects.toBeInstanceOf(RoomFullError);

    expect(full).toEqual([
      {
        members: ['a', 'b'],
        memberCount: 2,
        memberCapacity: 2,
        peerIds: ['a', 'b'],
        maxPeers: 2,
      },
      {
        members: ['a', 'b'],
        memberCount: 2,
        memberCapacity: 2,
        peerIds: ['a', 'b'],
        maxPeers: 2,
      },
    ]);
    expect(signaling.join).not.toHaveBeenCalled();
    expect(signaling.createPeerSignaling).not.toHaveBeenCalled();

    room.close();
  });

  it('waits for the first presence snapshot before joining when capacity is finite', async () => {
    const signaling = createTestRoomSignaling();
    const room = await watchP2PRoom({
      signaling,
      peerId: 'c',
      memberCapacity: 2,
    });

    // Join before any presence has been delivered (e.g. a backend that only
    // pushes peers asynchronously). The room must not join blind.
    const joinPromise = room.join();
    signaling.emitPeers(['a', 'b']);

    await expect(joinPromise).rejects.toBeInstanceOf(RoomFullError);
    expect(signaling.join).not.toHaveBeenCalled();
    expect(signaling.createPeerSignaling).not.toHaveBeenCalled();

    room.close();
  });

  it('allows joining when memberCapacity is reached but local member is present', async () => {
    sessionMocks.startP2PSession.mockResolvedValue(createResolvedSession());
    const signaling = createTestRoomSignaling();
    const full = [];
    const room = await watchP2PRoom({
      signaling,
      peerId: 'a',
      memberCapacity: 2,
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
      memberCapacity: 2,
      onFull: (detail) => full.push(detail),
    });

    signaling.emitPeers(['a']);
    const joinPromise = room.join();
    signaling.emitPeers(['a', 'b']);
    await flushAsyncWork();

    expect(full).toEqual([
      {
        members: ['a', 'b'],
        memberCount: 2,
        memberCapacity: 2,
        peerIds: ['a', 'b'],
        maxPeers: 2,
      },
    ]);

    join.resolve();

    await expect(joinPromise).rejects.toBeInstanceOf(RoomFullError);
    expect(signaling.leave).toHaveBeenCalledWith('c');
    expect(signaling.createPeerSignaling).not.toHaveBeenCalled();
    expect(full).toEqual([
      {
        members: ['a', 'b'],
        memberCount: 2,
        memberCapacity: 2,
        peerIds: ['a', 'b'],
        maxPeers: 2,
      },
      {
        members: ['a', 'b'],
        memberCount: 2,
        memberCapacity: 2,
        peerIds: ['a', 'b'],
        maxPeers: 2,
      },
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
      memberCapacity: 2,
    });

    signaling.emitPeers(['a']);
    const joinPromise = room.join();
    signaling.emitPeers(['a', 'b']);
    await flushAsyncWork();

    join.resolve();

    await expect(joinPromise).rejects.toBeInstanceOf(RoomFullError);
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
    expect(errors).toEqual([
      { peerId: 'b', memberId: 'b', error: startupError },
    ]);
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
