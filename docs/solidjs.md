# SolidJS

Use `useP2PRoom` to bind `P2PRoom` lifecycle, state, and stream events to
Solid accessors.

```tsx
import { For, Show, createEffect, onCleanup } from 'solid-js';
import { createMediaPlayback, useP2PRoom } from '@kidlib/p2p/solid';

export function Room({ createSignaling }) {
  const room = useP2PRoom();

  async function join(roomId: string) {
    await room.join({
      roomId,
      peerId: crypto.randomUUID(),
      createSignaling,
      presenceData: { displayName: 'Ada' },
      getLocalStream: () =>
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
      memberCapacity: 6,
    });
  }

  async function exit() {
    await room.dispose();
  }

  onCleanup(exit);

  return (
    <main>
      <button
        onClick={() => join('demo-room')}
        disabled={room.state() === 'joined'}
      >
        Join
      </button>
      <button onClick={exit} disabled={room.state() !== 'joined'}>
        Exit
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
  const playback = createMediaPlayback();

  createEffect(() => {
    playback.attach(video, props.stream, { muted: props.muted });
  });

  return (
    <>
      <video ref={video} autoplay muted={props.muted} playsInline />
      <Show when={playback.playbackBlocked()}>
        <button onClick={() => playback.resumePlayback()}>
          Continue call
        </button>
      </Show>
    </>
  );
}
```

`join()` watches presence, enters the room, and connects to peers. `leave()`
exits presence while keeping the room reusable. `dispose()` awaits intentional
departure and permanently tears down the room, subscriptions, connections, and
owned media.
Use `room.memberPresence()` for the metadata-aware roster. It is the Solid
accessor form of `P2PRoom.memberPresence`, while `room.members()` remains the
ID-only compatibility list.

`createMediaPlayback()` is independent from room state. Use it when the app
owns the `<video>` elements and wants one reusable browser playback handshake:
set `srcObject`, call `play()`, expose `playbackBlocked()`, and retry through
`resumePlayback()` from a user gesture. For non-Solid element code, use
`attachMediaStream(video, stream, options)` directly.
