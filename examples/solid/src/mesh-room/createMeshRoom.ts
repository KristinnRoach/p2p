import { createMemo, createSignal, onCleanup } from 'solid-js';
import { joinP2PRoom } from '@kidlib/p2p';
import { createLocalMedia } from './createLocalMedia';
import {
  removePeer,
  removeRemoteStream,
  upsertPeer,
  upsertRemoteStream,
} from './roomState';
import type {
  CreateMeshRoomOptions,
  JoinRoomOptions,
  MeshRoomController,
  RoomPeer,
  RoomRemoteStream,
  RoomStatus,
} from './roomTypes';

type P2PRoom = Awaited<ReturnType<typeof joinP2PRoom>>;

export function createMeshRoom(
  options: CreateMeshRoomOptions,
): MeshRoomController {
  const peerId = options.peerId ?? crypto.randomUUID();
  const media = createLocalMedia();
  const [status, setStatus] = createSignal<RoomStatus>('idle');
  const [error, setError] = createSignal<string>();
  const [peers, setPeers] = createSignal<RoomPeer[]>([]);
  const [remoteStreams, setRemoteStreams] = createSignal<RoomRemoteStream[]>(
    [],
  );

  let room: P2PRoom | undefined;

  const isJoining = createMemo(() => status() === 'joining');
  const isJoined = createMemo(() => status() === 'joined');

  async function join(joinOptions: JoinRoomOptions) {
    if (status() === 'joining' || status() === 'joined') return;

    closeRoomOnly();
    setStatus('joining');
    setError(undefined);
    setPeers([]);
    setRemoteStreams([]);

    if (joinOptions.resetRoom) {
      options.resetRoom?.(joinOptions.roomId);
    }

    try {
      const localStream = await media.start(joinOptions.media);
      const nextRoom = await joinP2PRoom({
        signaling: options.createSignaling(joinOptions.roomId),
        peerId,
        localStream,
        maxPeers: options.maxPeers ?? Infinity,
        onPeerJoined: ({ peerId }) => {
          setPeers((items) => upsertPeer(items, peerId));
        },
        onPeerStream: ({ peerId, stream }) => {
          setPeers((items) => upsertPeer(items, peerId));
          setRemoteStreams((items) =>
            upsertRemoteStream(items, peerId, stream),
          );
        },
        onPeerLeft: ({ peerId }) => {
          setPeers((items) => removePeer(items, peerId));
          setRemoteStreams((items) => removeRemoteStream(items, peerId));
        },
        onFull: () => {
          setStatus('full');
          setError('Room is full.');
        },
      });
      nextRoom.on('error', ({ error }) => {
        console.error(error);
        setError('A peer connection failed.');
      });

      if (status() === 'full') {
        nextRoom.close();
        media.stop();
        return;
      }

      room = nextRoom;
      setStatus('joined');
    } catch (err) {
      console.error(err);
      closeRoomOnly();
      media.stop();
      setStatus('error');
      setError(media.error() ?? 'Could not join room.');
    }
  }

  async function leave() {
    if (!room) {
      close();
      return;
    }

    setStatus('leaving');
    await room.leave();
    close();
  }

  function close() {
    closeRoomOnly();
    media.stop();
    setPeers([]);
    setRemoteStreams([]);
    setStatus('idle');
  }

  function send(peerId: string, data: unknown) {
    room?.send(peerId, data);
  }

  function broadcast(data: unknown) {
    return room?.broadcast(data) ?? 0;
  }

  function closeRoomOnly() {
    room?.close();
    room = undefined;
  }

  onCleanup(close);

  return {
    peerId,
    status,
    error,
    localStream: media.stream,
    peers,
    remoteStreams,
    isJoining,
    isJoined,
    join,
    leave,
    close,
    send,
    broadcast,
  };
}
