import { createSignal, onCleanup } from 'solid-js';
import { watchP2PRoom } from '@kidlib/p2p';
import {
  clearBrowserMeshRoom,
  createBrowserMeshRoomSignaling,
} from '@shared/index';

export type CallRole = 'initiator' | 'joiner';

type P2PRoom = Awaited<ReturnType<typeof watchP2PRoom>>;
type RemoteStream = { peerId: string; stream: MediaStream };

export function useP2PRoom() {
  const [localStream, setLocalStream] = createSignal<MediaStream>();
  const [remoteStreams, setRemoteStreams] = createSignal<RemoteStream[]>([]);
  const [isStarting, setIsStarting] = createSignal(false);
  const [isInCall, setIsInCall] = createSignal(false);
  const [error, setError] = createSignal<string>();

  const localPeerId = crypto.randomUUID();
  let room: P2PRoom | undefined;

  async function start(roomId: string, role: CallRole) {
    if (isStarting() || isInCall()) return;

    setIsStarting(true);
    setError(undefined);
    if (role === 'initiator') clearBrowserMeshRoom(roomId);

    try {
      room = await watchP2PRoom({
        roomId,
        createSignaling: ({ roomId }) => createBrowserMeshRoomSignaling(roomId),
        getLocalStream: () =>
          navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          }),
        peerId: localPeerId,
        onLocalStream: ({ stream }) => setLocalStream(stream),
        onPeerStream: ({ peerId, stream }) => {
          setRemoteStreams((items) => [
            ...items.filter((item) => item.peerId !== peerId),
            { peerId, stream },
          ]);
        },
        onPeerLeft: ({ peerId }) => {
          setRemoteStreams((items) =>
            items.filter((item) => item.peerId !== peerId),
          );
        },
      });
      await room.join();

      setIsInCall(true);
    } catch (err) {
      console.error(err);
      setError('Could not start room.');
      stop();
    } finally {
      setIsStarting(false);
    }
  }

  function stop() {
    room?.close();
    room = undefined;
    for (const { stream } of remoteStreams()) stopStream(stream);

    setLocalStream(undefined);
    setRemoteStreams([]);
    setIsStarting(false);
    setIsInCall(false);
  }

  onCleanup(stop);

  return {
    localPeerId,
    localStream,
    remoteStreams,
    isStarting,
    error,
    start,
    stop,
    isInCall,
  };
}

function stopStream(stream: MediaStream | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}
