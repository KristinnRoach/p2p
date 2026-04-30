import { createSignal, onCleanup, onMount } from 'solid-js';
import {
  isLocalStreamError,
  isRoomFullError,
  watchP2PRoom,
} from '@kidlib/p2p';
import type { P2PRoom } from '@kidlib/p2p';
import type { RoomStatusType } from './RoomStatus';
import RoomStatus from './RoomStatus';
import LobbyForm from './LobbyForm';
import VideoGrid from './VideoGrid';
import { createBrowserMeshRoomSignaling } from '@shared/index';

export default function Room() {
  const MAX_MEMBERS = 6;
  const [room, setRoom] = createSignal<P2PRoom>();
  const [status, setStatus] = createSignal<RoomStatusType>('idle');
  const [error, setError] = createSignal<string>();

  async function enterRoom(roomId: string) {
    if (status() === 'joining' || status() === 'joined') return;

    closeRoom();
    setStatus('joining');
    setError(undefined);

    let p2pRoom: P2PRoom | undefined = undefined;

    try {
      p2pRoom = await watchP2PRoom({
        roomId,
        peerId: crypto.randomUUID(),
        createSignaling: createBrowserMeshRoomSignaling,
        getLocalStream: () =>
          navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
        memberCapacity: MAX_MEMBERS,
        onStateChange: ({ state }) => setStatus(state),
        onError: () => setError('A peer connection failed.'),
        onFull: () => setStatus('full'),
      });

      setRoom(p2pRoom);

      await p2pRoom.join();
    } catch (err) {
      closeRoom();
      if (isRoomFullError(err)) {
        setStatus('full');
      } else if (isLocalStreamError(err)) {
        setStatus('error');
        setError('Could not access camera or microphone.');
      } else {
        setStatus('error');
        setError('Could not join room.');
      }
    }
  }

  function leaveRoom() {
    closeRoom();
    setStatus('idle');
  }

  function closeRoom() {
    room()?.close();
    setRoom(undefined);
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
        isEntering={status() === 'joining'}
        isInRoom={status() === 'joined'}
        isLeaving={status() === 'leaving'}
        onEnterRoom={enterRoom}
        onLeaveRoom={leaveRoom}
      />
      <RoomStatus room={room()} status={status()} error={error()} />
      <VideoGrid room={room()} />
    </main>
  );
}
