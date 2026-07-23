import { describe, expect, it, vi, afterEach } from 'vitest';
import { defineP2PComponents } from '@kidlib/p2p/components';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('@kidlib/p2p/components', () => {
  it('defines the room primitives and joins through injected signaling', async () => {
    const createSignaling = vi.fn(({ roomId }) =>
      createTestRoomSignaling(roomId),
    );
    defineP2PComponents({
      createSignaling,
      getLocalStream: () => null,
    });

    const room = document.createElement('p2p-room');
    room.setAttribute('room-id', 'room-a');
    room.innerHTML = `
      <p2p-room-status></p2p-room-status>
      <p2p-chat></p2p-chat>
    `;
    document.body.append(room);

    await room.join();

    expect(createSignaling).toHaveBeenCalledWith({ roomId: 'room-a' });
    expect(room.snapshot()).toMatchObject({
      roomId: 'room-a',
      state: 'joined',
      error: '',
      memberCapacity: 6,
      memberCount: 0,
      openDataChannels: 0,
    });
    expect(
      room.querySelector('p2p-room-status').shadowRoot.textContent,
    ).toContain('Status: joined');
  });

  it('keeps local chat useful before peers connect', async () => {
    defineP2PComponents({
      createSignaling: ({ roomId }) => createTestRoomSignaling(roomId),
      getLocalStream: () => null,
    });

    const room = document.createElement('p2p-room');
    const chat = document.createElement('p2p-chat');
    room.append(chat);
    document.body.append(room);
    await room.join();

    const onMessage = vi.fn();
    room.addEventListener('p2p-chat-message', onMessage);

    const sent = room.sendChat('hello');

    expect(sent).toBe(0);
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          local: true,
          text: 'hello',
        }),
      }),
    );
    expect(chat.shadowRoot.textContent).toContain('hello');
  });

  it('cancels an in-flight join when the room leaves', async () => {
    let resolveStream;
    defineP2PComponents({
      createSignaling: ({ roomId }) => createTestRoomSignaling(roomId),
      getLocalStream: () =>
        new Promise((resolve) => {
          resolveStream = resolve;
        }),
    });

    const room = document.createElement('p2p-room');
    document.body.append(room);

    const joinPromise = room.join();
    await new Promise((resolve) => setTimeout(resolve, 0));
    room.leave();
    resolveStream(null);

    await expect(joinPromise).resolves.toBeUndefined();
    expect(room.snapshot()).toMatchObject({
      room: null,
      state: 'idle',
      localStream: null,
      remoteStreams: [],
    });
  });

  it('reports missing signaling without throwing from join', async () => {
    defineP2PComponents({
      createSignaling: null,
      getLocalStream: () => null,
    });

    const room = document.createElement('p2p-room');
    document.body.append(room);

    await expect(room.join()).resolves.toBeUndefined();

    expect(room.snapshot().error).toBe(
      'p2p-room requires a createSignaling function before joining',
    );
  });
});

function createTestRoomSignaling() {
  return {
    join: vi.fn(),
    leave: vi.fn(),
    onPeers: vi.fn((callback) => {
      callback({ members: [] });
      return vi.fn();
    }),
    createPeerSignaling: vi.fn(() => {
      throw new Error('Unexpected peer signaling request');
    }),
    cleanupSignaling: vi.fn(),
  };
}
