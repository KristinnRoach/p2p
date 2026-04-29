import { createSignal, onCleanup } from 'solid-js';
import { joinP2PRoom } from '@kidlib/p2p';
import {
  clearBrowserMeshRoom,
  createBrowserMeshRoomSignaling,
} from '@shared/index';

export type CallRole = 'initiator' | 'joiner';

type P2PRoom = Awaited<ReturnType<typeof joinP2PRoom>>;
type RemoteStream = { peerId: string; stream: MediaStream };

export function useP2PRoom() {
  const [localStream, setLocalStream] = createSignal<MediaStream>();
  const [remoteStreams, setRemoteStreams] = createSignal<RemoteStream[]>([]);
  const [isStarting, setIsStarting] = createSignal(false);
  const [isInCall, setIsInCall] = createSignal(false);
  const [error, setError] = createSignal<string>();

  const localPeerId = crypto.randomUUID();
  let room: P2PRoom | undefined;
  let local: MediaStream | undefined;

  async function start(roomId: string, role: CallRole) {
    if (isStarting() || isInCall()) return;

    setIsStarting(true);
    setError(undefined);
    if (role === 'initiator') clearBrowserMeshRoom(roomId);

    try {
      local = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(local);

      room = await joinP2PRoom({
        signaling: createBrowserMeshRoomSignaling(roomId),
        peerId: localPeerId,
        localStream: local,
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
    stopStream(local);
    local = undefined;
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
