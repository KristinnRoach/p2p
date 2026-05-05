import { For, Show } from 'solid-js';
import LocalPreview from './LocalPreview';
import MemberTile from './MemberTile';
import type { RemoteMemberStream } from '@kidlib/p2p';

type Props = {
  localStream?: MediaStream;
  remoteStreams: RemoteMemberStream[];
};

export default function VideoGrid(props: Props) {
  return (
    <div class='video-grid'>
      <Show when={props.localStream}>
        {(stream) => <LocalPreview stream={stream()} />}
      </Show>
      <For each={props.remoteStreams}>
        {(remote) => (
          <MemberTile memberId={remote.memberId} stream={remote.stream} />
        )}
      </For>
    </div>
  );
}
