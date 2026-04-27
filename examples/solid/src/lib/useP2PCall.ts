import { createSignal, onCleanup } from 'solid-js';
import { startP2PSession, joinP2PSession } from '@kidlib/p2p';
import { createBrowserTabSignaling } from '../../../shared/createBrowserTabSignaling';

export type CallRole = 'initiator' | 'joiner';

type P2PSession = Awaited<ReturnType<typeof startP2PSession>>;

export function useP2PCall() {
  const [localStream, setLocalStream] = createSignal<MediaStream>();
  const [remoteStream, setRemoteStream] = createSignal<MediaStream>();
  const [isStarting, setIsStarting] = createSignal(false);
  const [error, setError] = createSignal<string>();

  let session: P2PSession | undefined;

  async function start(roomId: string, role: CallRole) {
    if (session || isStarting()) return;

    setIsStarting(true);
    setError(undefined);

    try {
      const local = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      setLocalStream(local);

      const signalingRole = role === 'initiator' ? 'host' : 'guest';

      const signaling = createBrowserTabSignaling({
        roomId,
        role: signalingRole,
      });

      session =
        role === 'initiator'
          ? await startP2PSession({
              signaling,
              localStream: local,
              dataChannel: false,
            })
          : await joinP2PSession({
              signaling,
              localStream: local,
              dataChannel: false,
            });

      session.on('remoteStream', ({ stream }) => {
        setRemoteStream(stream);
      });
    } catch (err) {
      console.error(err);
      setError('Could not start call.');
      stop();
    } finally {
      setIsStarting(false);
    }
  }

  function stop() {
    session?.close();
    session = undefined;

    localStream()
      ?.getTracks()
      .forEach((track) => track.stop());
    remoteStream()
      ?.getTracks()
      .forEach((track) => track.stop());

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
    get isInCall() {
      return !!session;
    },
  };
}
