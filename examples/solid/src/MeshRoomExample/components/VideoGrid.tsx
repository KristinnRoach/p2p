import { createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import LocalPreview from './LocalPreview';
import MemberTile from './MemberTile';
import type { P2PRoom } from '@kidlib/p2p';

type Props = {
  room?: P2PRoom;
};

export type RemoteStream = {
  memberId: string;
  stream: MediaStream;
};

export default function VideoGrid(props: Props) {
  const [localStream, setLocalStream] = createSignal<MediaStream>();
  const [remoteStreams, setRemoteStreams] = createSignal<RemoteStream[]>([]);

  createEffect(() => {
    const room = props.room;
    if (!room) {
      setLocalStream(undefined);
      setRemoteStreams([]);
      return;
    }

    setLocalStream(room.localStream ?? undefined);
    setRemoteStreams(
      [...room.remoteStreams.entries()]
        .map(([memberId, stream]) => ({ memberId, stream }))
        .sort(compareMember),
    );

    const cleanups = [
      room.on('localStream', ({ stream }) => setLocalStream(stream)),
      room.on('memberStream', ({ memberId, stream }) => {
        setRemoteStreams((items) =>
          [
            ...items.filter((item) => item.memberId !== memberId),
            { memberId, stream },
          ].sort(compareMember),
        );
      }),
      room.on('memberLeft', ({ memberId }) => {
        setRemoteStreams((items) =>
          items.filter((item) => item.memberId !== memberId),
        );
      }),
    ];

    onCleanup(() => cleanups.forEach((cleanup) => cleanup()));
  });

  return (
    <div class='video-grid'>
      <Show when={localStream()}>
        {(stream) => <LocalPreview stream={stream()} />}
      </Show>
      <For each={remoteStreams()}>
        {(remote) => (
          <MemberTile memberId={remote.memberId} stream={remote.stream} />
        )}
      </For>
    </div>
  );
}

function compareMember(a: { memberId: string }, b: { memberId: string }) {
  return a.memberId.localeCompare(b.memberId);
}
