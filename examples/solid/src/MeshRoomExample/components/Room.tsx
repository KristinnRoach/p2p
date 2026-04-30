import { createSignal, onCleanup, onMount } from 'solid-js';
import { watchP2PRoom } from '@kidlib/p2p';
import type { P2PRoom } from '@kidlib/p2p';
import RoomStatus from './RoomStatus';
import Lobby from './Lobby';
import VideoGrid from './VideoGrid';
import type { RoomStatus as RoomStatusValue } from '../types';
import { isMediaError } from '../errors';
import { createBrowserMeshRoomSignaling } from '@shared/index';

export default function Room() {
  const peerId = crypto.randomUUID();
  const MAX_MEMBERS = 6;
  const [room, setRoom] = createSignal<P2PRoom>();
  const [status, setStatus] = createSignal<RoomStatusValue>('idle');
  const [error, setError] = createSignal<string>();

  async function enterRoom(roomId: string) {
    if (status() === 'joining' || status() === 'joined') return;

    closeRoom();
    setStatus('joining');
    setError(undefined);

    try {
      const p2pRoom = await watchP2PRoom({
        roomId,
        peerId,
        createSignaling: createBrowserMeshRoomSignaling,
        getLocalStream: () =>
          navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
        memberCapacity: MAX_MEMBERS,
        onStateChange: ({ state }) => setStatus(state),
      });

      p2pRoom.on('error', () => setError('A peer connection failed.'));
      p2pRoom.on('full', () => {
        setStatus('full');
        setError('Room is full.');
      });

      setRoom(p2pRoom);

      await p2pRoom.join();
    } catch (err) {
      closeRoom();
      if (p2pRoom?.isFull || status() === 'full') {
        setStatus('full');
        setError('Room is full.');
      } else if (isMediaError(err)) {
        setStatus('error');
        setError('Could not access camera or microphone.');
      } else {
        setStatus('error');
        setError('Could not join room.');
      }
    }
  }

  async function leaveRoom() {
    const currentRoom = room();
    if (!currentRoom) {
      closeRoom();
      setStatus('idle');
      return;
    }

    try {
      await currentRoom.leave();
      closeRoom();
      setStatus('idle');
    } catch (err) {
      console.error(err);
      closeRoom();
      setStatus('error');
      setError('Could not leave room.');
    }
  }

  function closeRoom() {
    room()?.close();
    setRoom(undefined);
  }

  onMount(async () => {
    const roomId = new URL(window.location.href).searchParams
      .get('room')
      ?.trim();
    if (roomId) await enterRoom(roomId);
  });

  onCleanup(closeRoom);

  return (
    <main class='room'>
      <Lobby
        status={status()}
        onEnterRoom={enterRoom}
        onLeaveRoom={leaveRoom}
      />
      <RoomStatus room={room()} status={status()} error={error()} />
      <VideoGrid room={room()} />
    </main>
  );
}
