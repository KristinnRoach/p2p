import { onCleanup, onMount } from 'solid-js';
import { useP2PRoom } from '@kidlib/p2p/solid';
import RoomStatus from './RoomStatus';
import LobbyForm from './LobbyForm';
import VideoGrid from './VideoGrid';
import { createBroadcastRoomSignaling } from '@shared/index';

export default function Room() {
  const MAX_MEMBERS = 6;
  const p2p = useP2PRoom();

  async function enterRoom(roomId: string) {
    const status = p2p.state();
    if (status === 'creating' || status === 'joining' || status === 'joined') {
      return;
    }

    await p2p.join({
      roomId,
      peerId: crypto.randomUUID(),
      createSignaling: createBroadcastRoomSignaling,
      getLocalStream: () =>
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
      memberCapacity: MAX_MEMBERS,
    });
  }

  function closeRoom() {
    p2p.close();
  }

  function errorMessage() {
    switch (p2p.errorKind()) {
      case 'room-full':
        return 'The room is full.';
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
        isEntering={p2p.state() === 'creating' || p2p.state() === 'joining'}
        isInRoom={p2p.state() === 'joined'}
        isExiting={p2p.state() === 'leaving'}
        onEnterRoom={enterRoom}
        onExitRoom={closeRoom}
      />
      <RoomStatus
        roomId={p2p.room()?.roomId}
        memberCount={p2p.memberCount()}
        memberCapacity={p2p.memberCapacity()}
        status={p2p.state()}
        error={errorMessage()}
      />
      <VideoGrid
        localStream={p2p.localStream()}
        remoteStreams={p2p.remoteMemberStreams()}
      />
    </main>
  );
}
