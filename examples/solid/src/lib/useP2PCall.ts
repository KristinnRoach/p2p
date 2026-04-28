import { createSignal, onCleanup } from 'solid-js';
import { startP2PSession, joinP2PSession } from '@kidlib/p2p';
import {
  clearBrowserTabSignalingRoom,
  createBrowserTabSignaling,
} from '@shared';

export type CallRole = 'initiator' | 'joiner';

type P2PSession = Awaited<ReturnType<typeof startP2PSession>>;

export function useP2PCall() {
  const [localStream, setLocalStream] = createSignal<MediaStream>();
  const [remoteStream, setRemoteStream] = createSignal<MediaStream>();
  const [isStarting, setIsStarting] = createSignal(false);
  const [isInCall, setIsInCall] = createSignal(false);
  const [error, setError] = createSignal<string>();

  let session: P2PSession | undefined;
  let sessionAbortController: AbortController | undefined;

  function handleRemoteStream({ stream }: { stream: MediaStream }) {
    setRemoteStream(() => stream);
  }

  async function start(roomId: string, role: CallRole) {
    if (session || isStarting()) return;

    const controller = new AbortController();
    sessionAbortController = controller;
    setIsStarting(true);
    setError(undefined);

    let local: MediaStream | undefined;
    let signaling: ReturnType<typeof createBrowserTabSignaling> | undefined;

    try {
      local = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      if (controller.signal.aborted) {
        stopStream(local);
        return;
      }

      const signalingRole = role === 'initiator' ? 'host' : 'guest';

      if (role === 'initiator') {
        clearBrowserTabSignalingRoom(roomId);
      }

      signaling = createBrowserTabSignaling({
        roomId,
        role: signalingRole,
      });

      const nextSession =
        role === 'initiator'
          ? await startP2PSession({
              signaling,
              localStream: local,
              dataChannel: false,
              signal: controller.signal,
              onRemoteStream: handleRemoteStream,
            })
          : await joinP2PSession({
              signaling,
              localStream: local,
              dataChannel: false,
              signal: controller.signal,
              onRemoteStream: handleRemoteStream,
            });

      if (controller.signal.aborted) {
        nextSession.close();
        signaling.close();
        stopStream(local);
        return;
      }

      session = nextSession;
      setLocalStream(local);
      setIsInCall(true);
    } catch (err) {
      signaling?.close();
      stopStream(local);
      if (!controller.signal.aborted) {
        console.error(err);
        setError('Could not start call.');
        if (sessionAbortController === controller) {
          stop();
        }
      }
    } finally {
      if (sessionAbortController === controller) {
        sessionAbortController = undefined;
        setIsStarting(false);
      }
    }
  }

  function stop() {
    sessionAbortController?.abort();
    sessionAbortController = undefined;
    session?.close();
    session = undefined;
    setIsStarting(false);
    setIsInCall(false);

    stopStream(localStream());
    stopStream(remoteStream());

    setLocalStream(undefined);
    setRemoteStream(undefined);
  }

  onCleanup(stop);

  return {
    localStream,
    remoteStream,
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
