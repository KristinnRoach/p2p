import { onMount } from 'solid-js';
import { RoomStatus } from '../components/RoomStatus';
import { RoomToolbar } from '../components/RoomToolbar';
import { VideoGrid } from '../components/VideoGrid';
import { createMeshRoom } from '../mesh-room/createMeshRoom';
import { createRoomInvite } from '../mesh-room/createRoomInvite';
import {
  createBrowserMeshRoomSignaling,
  clearBrowserMeshRoom,
} from '@shared/index';

export function RoomRoute() {
  const room = createMeshRoom({
    createSignaling: ({ roomId }) => createBrowserMeshRoomSignaling(roomId),
    resetRoom: clearBrowserMeshRoom,
  });
  const invite = createRoomInvite();

  async function startRoom() {
    const { roomId, joinUrl } = invite.createRoom();
    await invite.copyJoinUrl(joinUrl);
    await room.join({ roomId, resetRoom: true });
  }

  onMount(async () => {
    const params = invite.readJoinParams();
    if (params) await room.join({ roomId: params.roomId });
  });

  return (
    <main>
      <RoomToolbar
        status={room.status()}
        isJoining={room.isJoining()}
        isJoined={room.isJoined()}
        onStart={startRoom}
        onLeave={room.leave}
      />
      <RoomStatus
        status={room.status()}
        error={room.error()}
        peerCount={room.peers().length}
      />
      <VideoGrid
        localStream={room.localStream()}
        remoteStreams={room.remoteStreams()}
      />
    </main>
  );
}
