import { For, Show } from 'solid-js';
import { LocalPreview } from './LocalPreview';
import { PeerTile } from './PeerTile';
import type { RoomRemoteStream } from '../mesh-room/roomTypes';

type Props = {
  localStream?: MediaStream;
  remoteStreams: RoomRemoteStream[];
};

export function VideoGrid(props: Props) {
  return (
    <div>
      <Show when={props.localStream}>
        {(stream) => <LocalPreview stream={stream()} />}
      </Show>
      <For each={props.remoteStreams}>
        {(remote) => (
          <PeerTile peerId={remote.peerId} stream={remote.stream} />
        )}
      </For>
    </div>
  );
}
