import { createRoot } from 'solid-js';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const roomMocks = vi.hoisted(() => ({
  watchP2PRoom: vi.fn(),
  isLocalStreamError: vi.fn((error) => error?.name === 'LocalStreamError'),
  isRoomFullError: vi.fn((error) => error?.name === 'RoomFullError'),
}));

vi.mock('../src/room.js', () => roomMocks);

import { useP2PRoom } from '../src/adapters/solid.js';

function createFakeRoom(overrides = {}) {
  const target = new EventTarget();
  const room = {
    roomId: 'room-a',
    peerId: 'peer-a',
    state: 'watching',
    localStream: null,
    remoteMemberStreams: [],
    members: [],
    memberCount: 0,
    memberCapacity: 4,
    isFull: false,
    dataChannels: new Map(),
    join: vi.fn(async () => {
      room.state = 'joined';
      room.emit('statechange', { previous: 'watching', state: 'joined' });
    }),
    leave: vi.fn(),
    close: vi.fn(),
    send: vi.fn(),
    broadcast: vi.fn(() => 1),
    on(type, callback) {
      const listener = (event) => callback(event.detail, event);
      target.addEventListener(type, listener);
      return () => target.removeEventListener(type, listener);
    },
    emit(type, detail) {
      target.dispatchEvent(new CustomEvent(type, { detail }));
    },
    ...overrides,
  };
  return room;
}

describe('useP2PRoom', () => {
  beforeEach(() => {
    roomMocks.watchP2PRoom.mockReset();
  });

  it('creates and joins a room from join options', async () => {
    const fakeRoom = createFakeRoom();
    roomMocks.watchP2PRoom.mockResolvedValue(fakeRoom);

    let solidRoom;
    const dispose = createRoot((dispose) => {
      solidRoom = useP2PRoom();
      return dispose;
    });

    const options = {
      signaling: {},
      peerId: 'peer-a',
    };

    const joinedRoom = await solidRoom.join(options);

    expect(roomMocks.watchP2PRoom).toHaveBeenCalledWith(options);
    expect(fakeRoom.join).toHaveBeenCalledOnce();
    expect(joinedRoom).toBe(fakeRoom);
    expect(solidRoom.state()).toBe('joined');

    dispose();
  });

  it('stores join errors instead of throwing them', async () => {
    const error = new Error('room full');
    error.name = 'RoomFullError';
    const fakeRoom = createFakeRoom({
      join: vi.fn(async () => {
        throw error;
      }),
    });
    roomMocks.watchP2PRoom.mockResolvedValue(fakeRoom);

    let solidRoom;
    const dispose = createRoot((dispose) => {
      solidRoom = useP2PRoom();
      return dispose;
    });

    await expect(
      solidRoom.join({
        signaling: {},
        peerId: 'peer-a',
      }),
    ).resolves.toBeUndefined();

    expect(solidRoom.state()).toBe('full');
    expect(solidRoom.error()).toBe(error);
    expect(solidRoom.errorKind()).toBe('room-full');

    dispose();
  });

  it('stores local stream errors and closes the room', async () => {
    const error = new Error('local stream failed');
    error.name = 'LocalStreamError';
    const fakeRoom = createFakeRoom({
      join: vi.fn(async () => {
        throw error;
      }),
    });
    roomMocks.watchP2PRoom.mockResolvedValue(fakeRoom);

    let solidRoom;
    const dispose = createRoot((dispose) => {
      solidRoom = useP2PRoom();
      return dispose;
    });

    await expect(
      solidRoom.join({
        signaling: {},
        peerId: 'peer-a',
      }),
    ).resolves.toBeUndefined();

    expect(fakeRoom.close).toHaveBeenCalledOnce();
    expect(solidRoom.room()).toBeUndefined();
    expect(solidRoom.state()).toBe('error');
    expect(solidRoom.error()).toBe(error);
    expect(solidRoom.errorKind()).toBe('local-stream');

    dispose();
  });

  it('updates Solid accessors from room events', async () => {
    const stream = new MediaStream();
    const fakeRoom = createFakeRoom();
    roomMocks.watchP2PRoom.mockResolvedValue(fakeRoom);

    let solidRoom;
    const dispose = createRoot((dispose) => {
      solidRoom = useP2PRoom();
      return dispose;
    });

    await solidRoom.join({
      signaling: {},
      peerId: 'peer-a',
    });

    fakeRoom.localStream = stream;
    fakeRoom.emit('localStream', { stream });

    fakeRoom.members = ['peer-b'];
    fakeRoom.memberCount = 1;
    fakeRoom.remoteMemberStreams = [{ memberId: 'peer-b', stream }];
    fakeRoom.emit('membersChanged', {
      members: ['peer-b'],
      memberCount: 1,
      memberCapacity: 4,
    });

    expect(solidRoom.localStream()).toBe(stream);
    expect(solidRoom.members()).toEqual(['peer-b']);
    expect(solidRoom.memberCount()).toBe(1);
    expect(solidRoom.remoteMemberStreams()).toEqual([
      { memberId: 'peer-b', stream },
    ]);

    dispose();
  });

  it('clears stale errors when the room becomes full', async () => {
    const stream = new MediaStream();
    const error = new Error('peer failed');
    const fakeRoom = createFakeRoom();
    roomMocks.watchP2PRoom.mockResolvedValue(fakeRoom);

    let solidRoom;
    const dispose = createRoot((dispose) => {
      solidRoom = useP2PRoom();
      return dispose;
    });

    await solidRoom.join({
      signaling: {},
      peerId: 'peer-a',
    });

    fakeRoom.emit('error', { error });
    expect(solidRoom.error()).toBe(error);
    expect(solidRoom.errorKind()).toBe('peer');

    fakeRoom.remoteMemberStreams = [{ memberId: 'peer-b', stream }];
    fakeRoom.members = ['peer-b'];
    fakeRoom.memberCount = 1;
    fakeRoom.isFull = true;
    fakeRoom.emit('full', {
      members: ['peer-b'],
      memberCount: 1,
      memberCapacity: 1,
    });

    expect(solidRoom.error()).toBeUndefined();
    expect(solidRoom.errorKind()).toBe('room-full');
    expect(solidRoom.state()).toBe('full');
    expect(solidRoom.isFull()).toBe(true);

    dispose();
  });

  describe('dataChannels signal', () => {
    it('adds a channel when dataChannel event fires', async () => {
      const fakeRoom = createFakeRoom();
      roomMocks.watchP2PRoom.mockResolvedValue(fakeRoom);

      let solidRoom;
      const dispose = createRoot((dispose) => {
        solidRoom = useP2PRoom();
        return dispose;
      });

      await solidRoom.join({ signaling: {}, peerId: 'peer-a' });

      const channel = {};
      fakeRoom.dataChannels.set('peer-b', channel);
      fakeRoom.emit('dataChannel', { memberId: 'peer-b', channel });

      expect(solidRoom.dataChannels().get('peer-b')).toBe(channel);
      expect(solidRoom.dataChannels().size).toBe(1);

      dispose();
    });

    it('removes a channel on dataChannelClose even when already absent from the room Map', async () => {
      const fakeRoom = createFakeRoom();
      roomMocks.watchP2PRoom.mockResolvedValue(fakeRoom);

      let solidRoom;
      const dispose = createRoot((dispose) => {
        solidRoom = useP2PRoom();
        return dispose;
      });

      await solidRoom.join({ signaling: {}, peerId: 'peer-a' });

      const channel = {};
      fakeRoom.dataChannels.set('peer-b', channel);
      fakeRoom.emit('dataChannel', { memberId: 'peer-b', channel });
      expect(solidRoom.dataChannels().size).toBe(1);

      // P2PRoom removes the channel from its Map before emitting dataChannelClose;
      // the signal must still update correctly from its own previous state.
      fakeRoom.dataChannels.delete('peer-b');
      fakeRoom.emit('dataChannelClose', { memberId: 'peer-b', channel });

      expect(solidRoom.dataChannels().has('peer-b')).toBe(false);

      dispose();
    });

    it('removes a channel when the member leaves', async () => {
      const fakeRoom = createFakeRoom();
      roomMocks.watchP2PRoom.mockResolvedValue(fakeRoom);

      let solidRoom;
      const dispose = createRoot((dispose) => {
        solidRoom = useP2PRoom();
        return dispose;
      });

      await solidRoom.join({ signaling: {}, peerId: 'peer-a' });

      const channel = {};
      fakeRoom.dataChannels.set('peer-b', channel);
      fakeRoom.emit('dataChannel', { memberId: 'peer-b', channel });
      expect(solidRoom.dataChannels().size).toBe(1);

      fakeRoom.dataChannels.delete('peer-b');
      fakeRoom.members = [];
      fakeRoom.memberCount = 0;
      fakeRoom.remoteMemberStreams = [];
      fakeRoom.emit('memberLeft', { memberId: 'peer-b', stream: null });

      expect(solidRoom.dataChannels().has('peer-b')).toBe(false);

      dispose();
    });
  });

  it('ignores stale join completions after the room is closed', async () => {
    let resolveJoin;
    const fakeRoom = createFakeRoom({
      join: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveJoin = resolve;
          }),
      ),
    });
    roomMocks.watchP2PRoom.mockResolvedValue(fakeRoom);

    let solidRoom;
    const dispose = createRoot((dispose) => {
      solidRoom = useP2PRoom();
      return dispose;
    });

    const joinPromise = solidRoom.join({
      signaling: {},
      peerId: 'peer-a',
    });

    await vi.waitFor(() => expect(fakeRoom.join).toHaveBeenCalledOnce());

    solidRoom.close();

    fakeRoom.state = 'joined';
    fakeRoom.memberCount = 1;
    resolveJoin();

    await expect(joinPromise).resolves.toBeUndefined();
    expect(solidRoom.state()).toBe('idle');
    expect(solidRoom.memberCount()).toBe(0);

    dispose();
  });
});
