# SolidJS

Use `useP2PRoom` to bind `P2PRoom` lifecycle, state, and stream events to
Solid accessors.

```tsx
import { For, Show, createEffect, onCleanup } from 'solid-js';
import { useP2PRoom } from '@kidlib/p2p/solid';

export function Room({ createSignaling }) {
  const room = useP2PRoom();

  async function join(roomId: string) {
    await room.join({
      roomId,
      peerId: crypto.randomUUID(),
      createSignaling,
      getLocalStream: () =>
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
      memberCapacity: 6,
    });
  }

  function leave() {
    room.close();
  }

  onCleanup(leave);

  return (
    <main>
      <button
        onClick={() => join('demo-room')}
        disabled={room.state() === 'joined'}
      >
        Join
      </button>
      <button onClick={leave} disabled={room.state() !== 'joined'}>
        Leave
      </button>

      <p>
        {room.state()} - {room.memberCount()} / {room.memberCapacity() ?? '-'}
      </p>

      <Show when={room.errorKind()}>
        {(kind) => <p>Could not join room: {kind()}</p>}
      </Show>

      <Show when={room.localStream()}>
        {(stream) => <Video stream={stream()} muted />}
      </Show>

      <For each={room.remoteMemberStreams()}>
        {(remote) => <Video stream={remote.stream} />}
      </For>
    </main>
  );
}

function Video(props: { stream: MediaStream; muted?: boolean }) {
  let video!: HTMLVideoElement;

  createEffect(() => {
    video.srcObject = props.stream;
    video.play().catch(() => {});
  });

  return <video ref={video} autoplay muted={props.muted} />;
}
```

`join()` watches presence, enters the room, and connects to peers. `close()`
tears down the room, subscriptions, connections, and owned media.
