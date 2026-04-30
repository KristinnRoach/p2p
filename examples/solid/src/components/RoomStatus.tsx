import { Show } from 'solid-js';
import type { RoomStatus as RoomStatusValue } from '../mesh-room/roomTypes';

type Props = {
  status: RoomStatusValue;
  error?: string;
  peerCount: number;
};

export default function RoomStatus(props: Props) {
  return (
    <div class='room-status'>
      <p>Remote peers: {props.peerCount}</p>
      <Show when={props.status === 'full'}>
        <p>Room is full.</p>
      </Show>
      <Show when={props.error && props.status !== 'full'}>
        <p>{props.error}</p>
      </Show>
    </div>
  );
}
