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

function nextPeersMatching(signaling, predicate) {
  return new Promise((resolve) => {
    let cleanup = null;
    cleanup = signaling.onPeers((snapshot) => {
      if (!predicate(snapshot)) return;
      cleanup?.();
      resolve(snapshot);
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

      await expect(nextPeers(signaling)).resolves.toEqual({
        members: [{ memberId: 'peer-a' }, { memberId: 'peer-b' }],
      });

      await signaling.refreshPresence('peer-a');

      await expect(nextPeers(signaling)).resolves.toEqual({
        members: [{ memberId: 'peer-a' }, { memberId: 'peer-b' }],
      });
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

      await expect(nextPeers(signaling)).resolves.toEqual({
        members: [
          {
            memberId: 'peer-a',
            data: { displayName: 'Ada', muted: false },
          },
          { memberId: 'peer-b' },
        ],
      });

      await signaling.updatePresenceData('peer-a', {
        displayName: 'Ada',
        muted: true,
      });

      await expect(nextPeers(signaling)).resolves.toEqual({
        members: [
          {
            memberId: 'peer-a',
            data: { displayName: 'Ada', muted: true },
          },
          { memberId: 'peer-b' },
        ],
      });
    } finally {
      signaling.cleanupSignaling();
      clearBroadcastRoomSignaling(roomId);
    }
  });

  it('marks explicit leaves on the removal snapshot', async () => {
    const roomId = `test-${crypto.randomUUID()}`;
    const signaling = createBroadcastRoomSignaling(roomId);

    try {
      await signaling.join('peer-a');
      await signaling.join('peer-b');
      await signaling.leave('peer-b');

      await expect(nextPeers(signaling)).resolves.toEqual({
        members: [{ memberId: 'peer-a' }],
        departed: [{ memberId: 'peer-b', reason: 'left' }],
      });
    } finally {
      signaling.cleanupSignaling();
      clearBroadcastRoomSignaling(roomId);
    }
  });

  it('delivers an exact departure transition across a later heartbeat', async () => {
    const roomId = `test-${crypto.randomUUID()}`;
    const signaling = createBroadcastRoomSignaling(roomId);

    try {
      await signaling.join('peer-a');
      await signaling.join('peer-b');
      const departure = nextPeersMatching(
        signaling,
        (snapshot) => snapshot.departed?.[0]?.memberId === 'peer-b',
      );

      await signaling.leave('peer-b');
      await signaling.refreshPresence('peer-a');

      await expect(departure).resolves.toEqual({
        members: [{ memberId: 'peer-a' }],
        departed: [{ memberId: 'peer-b', reason: 'left' }],
      });
    } finally {
      signaling.cleanupSignaling();
      clearBroadcastRoomSignaling(roomId);
    }
  });
});
