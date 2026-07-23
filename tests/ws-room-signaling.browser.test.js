import { afterEach, describe, expect, it } from 'vitest';
import { createWebSocketRoomSignaling } from '../examples/shared/signaling/createWSRoomSignaling.js';

const originalWebSocket = globalThis.WebSocket;

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

describe('createWebSocketRoomSignaling', () => {
  it('includes the local peer in presence snapshots', async () => {
    let socket;
    globalThis.WebSocket = class FakeWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      readyState = FakeWebSocket.OPEN;
      sentMessages = [];

      constructor() {
        super();
        socket = this;
      }

      send(message) {
        this.sentMessages.push(JSON.parse(message));
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
      }
    };

    const signaling = createWebSocketRoomSignaling({
      url: 'ws://example.invalid',
      roomId: 'room-1',
    });
    const snapshots = [];

    signaling.onPeers((peers) => snapshots.push(peers));
    await signaling.join('peer-a');
    socket.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'peers',
          roomId: 'room-1',
          peerIds: ['peer-b', 'peer-a'],
          departed: [{ memberId: 'peer-c', reason: 'left' }],
        }),
      }),
    );

    expect(snapshots.at(-1)).toEqual({
      members: [{ memberId: 'peer-a' }, { memberId: 'peer-b' }],
      departed: [{ memberId: 'peer-c', reason: 'left' }],
    });
    expect(socket.sentMessages).toContainEqual({
      type: 'join-room',
      roomId: 'room-1',
      peerId: 'peer-a',
    });

    signaling.cleanupSignaling();
  });
});
