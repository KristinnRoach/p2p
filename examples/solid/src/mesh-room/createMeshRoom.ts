import { createMemo, createSignal, onCleanup } from 'solid-js';
import { watchP2PRoom } from '@kidlib/p2p';
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

type P2PRoom = Awaited<ReturnType<typeof watchP2PRoom>>;

export function createMeshRoom(
  options: CreateMeshRoomOptions,
): MeshRoomController {
  const peerId = options.peerId ?? crypto.randomUUID();
  const [localStream, setLocalStream] = createSignal<MediaStream>();
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
      const nextRoom = await watchP2PRoom({
        roomId: joinOptions.roomId,
        createSignaling: options.createSignaling,
        peerId,
        getLocalStream: () =>
          navigator.mediaDevices.getUserMedia(joinOptions.media ?? defaultMedia),
        maxPeers: options.maxPeers ?? Infinity,
        onLocalStream: ({ stream }) => setLocalStream(stream),
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
      room = nextRoom;
      nextRoom.on('error', ({ error }) => {
        console.error(error);
        setError('A peer connection failed.');
      });

      await nextRoom.join();

      setStatus('joined');
    } catch (err) {
      console.error(err);
      closeRoomOnly();
      if (isRoomFullError(err) || status() === 'full') {
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
    setLocalStream(undefined);
  }

  onCleanup(close);

  return {
    peerId,
    status,
    error,
    localStream,
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

function isRoomFullError(error: unknown) {
  return error instanceof Error && error.name === 'RoomFullError';
}

function isMediaError(error: unknown) {
  return (
    error instanceof DOMException &&
    [
      'AbortError',
      'NotAllowedError',
      'NotFoundError',
      'NotReadableError',
    ].includes(error.name)
  );
}

const defaultMedia: MediaStreamConstraints = {
  video: true,
  audio: true,
};
