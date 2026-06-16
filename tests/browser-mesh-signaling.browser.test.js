import { describe, expect, it } from 'vitest';
import {
  clearBroadcastRoomSignaling,
  createBroadcastRoomSignaling,
} from '../examples/shared/signaling/createBroadcastRoomSignaling.js';

function nextPeers(signaling) {
  return new Promise((resolve) => {
    let cleanup = null;
    cleanup = signaling.onPeers((peers) => {
      cleanup?.();
      resolve(peers);
    });
  });
}

describe('createBroadcastRoomSignaling', () => {
  it('keeps peer order stable when refreshing presence', async () => {
    const roomId = `test-${crypto.randomUUID()}`;
    const signaling = createBroadcastRoomSignaling(roomId);

    try {
      await signaling.join('peer-a');
      await signaling.join('peer-b');

      await expect(nextPeers(signaling)).resolves.toEqual(['peer-a', 'peer-b']);

      await signaling.refreshPresence('peer-a');

      await expect(nextPeers(signaling)).resolves.toEqual(['peer-a', 'peer-b']);
    } finally {
      signaling.cleanupSignaling();
      clearBroadcastRoomSignaling(roomId);
    }
  });

  it('carries optional presence data in peer snapshots', async () => {
    const roomId = `test-${crypto.randomUUID()}`;
    const signaling = createBroadcastRoomSignaling(roomId);

    try {
      await signaling.join('peer-a', { displayName: 'Ada', muted: false });
      await signaling.join('peer-b');

      await expect(nextPeers(signaling)).resolves.toEqual([
        {
          memberId: 'peer-a',
          data: { displayName: 'Ada', muted: false },
        },
        { memberId: 'peer-b' },
      ]);

      await signaling.updatePresenceData('peer-a', {
        displayName: 'Ada',
        muted: true,
      });

      await expect(nextPeers(signaling)).resolves.toEqual([
        {
          memberId: 'peer-a',
          data: { displayName: 'Ada', muted: true },
        },
        { memberId: 'peer-b' },
      ]);
    } finally {
      signaling.cleanupSignaling();
      clearBroadcastRoomSignaling(roomId);
    }
  });
});
