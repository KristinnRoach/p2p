import { For, Show, onMount } from 'solid-js';
import { VideoStream } from './VideoStream';
import { useP2PRoom } from '../lib/useP2PRoom';
import { createRoomId, createJoinUrl, readJoinParams } from '../lib/utils';

export default function Room() {
  const call = useP2PRoom();

  async function startCall() {
    const roomId = createRoomId();
    const joinUrl = createJoinUrl(roomId);

    try {
      await navigator.clipboard.writeText(joinUrl);
    } catch (err) {
      console.warn('Could not copy join URL to clipboard', err);
    }

    console.info('Starting call with roomId', roomId, 'joinUrl', joinUrl);
    await call.start(roomId, 'initiator');
  }

  async function joinCall(roomId: string) {
    console.info('Joining call with roomId', roomId);
    await call.start(roomId, 'joiner');
  }

  onMount(async () => {
    const params = readJoinParams();

    if (params) {
      console.info('[MOUNT] join params: ', params);
      await joinCall(params.roomId);
    }
  });

  return (
    <div>
      <Show when={!call.isInCall()}>
        <button onClick={startCall} disabled={call.isStarting()}>
          {call.isStarting() ? 'Starting...' : 'Start call'}
        </button>
      </Show>

      <Show when={call.isInCall()}>
        <button onClick={call.stop}>End call</button>
      </Show>

      <Show when={call.error()}>
        <p>{call.error()}</p>
      </Show>

      <VideoStream label='local' stream={call.localStream()} muted />
      <For each={call.remoteStreams()}>
        {(remote) => (
          <VideoStream
            label={`remote ${remote.peerId.slice(0, 8)}`}
            stream={remote.stream}
          />
        )}
      </For>
    </div>
  );
}
