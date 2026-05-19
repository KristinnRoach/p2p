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
});
