import { Show, onMount } from 'solid-js';
import { VideoStream } from './VideoStream';
import { useP2PCall } from '../lib/useP2PCall';
import { createRoomId, createJoinUrl, readJoinParams } from '../lib/callLink';

export default function CallPage() {
  const call = useP2PCall();

  async function startCall() {
    const roomId = createRoomId();
    const joinUrl = createJoinUrl(roomId);
    await navigator.clipboard.writeText(joinUrl);

    console.warn('role: initiator', 'roomId', roomId, 'joinUrl', joinUrl);

    await call.start(roomId, 'initiator');
  }

  onMount(() => {
    const params = readJoinParams();

    if (params) {
      console.warn(
        '[MOUNT] role: ',
        params.role,
        'roomId',
        params.roomId,
        'params',
        params,
      );

      call.start(params.roomId, params.role);
    }
  });

  return (
    <div>
      <Show when={!call.isInCall}>
        <button onClick={startCall} disabled={call.isStarting()}>
          {call.isStarting() ? 'Starting...' : 'Start call'}
        </button>
      </Show>

      <Show when={call.isInCall}>
        <button onClick={call.stop}>End call</button>
      </Show>

      <Show when={call.error()}>
        <p>{call.error()}</p>
      </Show>

      <VideoStream stream={call.localStream()} muted />
      <VideoStream stream={call.remoteStream()} />
    </div>
  );
}
