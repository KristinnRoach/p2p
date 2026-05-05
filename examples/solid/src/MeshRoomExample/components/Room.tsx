import { onCleanup, onMount } from 'solid-js';
import { useP2PRoom } from '@kidlib/p2p/solid';
import RoomStatus from './RoomStatus';
import LobbyForm from './LobbyForm';
import VideoGrid from './VideoGrid';
import { createBrowserMeshRoomSignaling } from '@shared/index';

export default function Room() {
  const MAX_MEMBERS = 6;
  const p2pRoom = useP2PRoom();

  async function enterRoom(roomId: string) {
    const status = p2pRoom.state();
    if (status === 'joining' || status === 'joined') return;

    closeRoom();

    await p2pRoom.join({
      roomId,
      peerId: crypto.randomUUID(),
      createSignaling: createBrowserMeshRoomSignaling,
      getLocalStream: () =>
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
      memberCapacity: MAX_MEMBERS,
    });
  }

  function leaveRoom() {
    closeRoom();
  }

  function closeRoom() {
    p2pRoom.close();
  }

  function errorMessage() {
    switch (p2pRoom.errorKind()) {
      case 'local-stream':
        return 'Could not access camera or microphone.';
      case 'peer':
        return 'A peer connection failed.';
      case 'room':
        return 'Could not join room.';
      default:
        return undefined;
    }
  }

  onMount(async () => {
    const roomId = new URL(window.location.href).searchParams
      .get('room')
      ?.trim();
    if (roomId) await enterRoom(roomId).catch(console.error);
  });

  onCleanup(closeRoom);

  return (
    <main class='room'>
      <LobbyForm
        isEntering={p2pRoom.state() === 'joining'}
        isInRoom={p2pRoom.state() === 'joined'}
        isLeaving={p2pRoom.state() === 'leaving'}
        onEnterRoom={enterRoom}
        onLeaveRoom={leaveRoom}
      />
      <RoomStatus
        roomId={p2pRoom.room()?.roomId}
        memberCount={p2pRoom.memberCount()}
        memberCapacity={p2pRoom.memberCapacity()}
        status={p2pRoom.state()}
        error={errorMessage()}
      />
      <VideoGrid
        localStream={p2pRoom.localStream()}
        remoteStreams={p2pRoom.remoteMemberStreams()}
      />
    </main>
  );
}
