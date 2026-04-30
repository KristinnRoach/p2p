import { createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import LocalPreview from './LocalPreview';
import MemberTile from './MemberTile';
import type { P2PRoom, RemoteMemberStream } from '@kidlib/p2p';

type Props = {
  room?: P2PRoom;
};

export default function VideoGrid(props: Props) {
  const [localStream, setLocalStream] = createSignal<MediaStream>();
  const [remoteStreams, setRemoteStreams] = createSignal<RemoteMemberStream[]>(
    [],
  );

  createEffect(() => {
    const room = props.room;
    if (!room) {
      setLocalStream(undefined);
      setRemoteStreams([]);
      return;
    }

    setLocalStream(room.localStream ?? undefined);
    setRemoteStreams(room.remoteMemberStreams);

    const updateRemoteStreams = () =>
      setRemoteStreams(room.remoteMemberStreams);

    const cleanups = [
      room.on('localStream', ({ stream }) => setLocalStream(stream)),
      room.on('memberStream', updateRemoteStreams),
      room.on('memberLeft', updateRemoteStreams),
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
