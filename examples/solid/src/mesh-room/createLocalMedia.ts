import { createSignal, onCleanup } from 'solid-js';

type LocalMediaStatus = 'idle' | 'requesting' | 'ready' | 'error';

export function createLocalMedia() {
  const [stream, setStream] = createSignal<MediaStream>();
  const [status, setStatus] = createSignal<LocalMediaStatus>('idle');
  const [error, setError] = createSignal<string>();

  async function start(constraints: MediaStreamConstraints = defaultMedia) {
    stop();
    setStatus('requesting');
    setError(undefined);

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(nextStream);
      setStatus('ready');
      return nextStream;
    } catch (err) {
      console.error(err);
      setStatus('error');
      setError('Could not access camera or microphone.');
      throw err;
    }
  }

  function stop() {
    stream()?.getTracks().forEach((track) => track.stop());
    setStream(undefined);
    setStatus('idle');
  }

  onCleanup(stop);

  return {
    stream,
    status,
    error,
    start,
    stop,
  };
}

const defaultMedia: MediaStreamConstraints = {
  video: true,
  audio: true,
};
