import { Show } from 'solid-js';
import type { SolidP2PRoomState } from '@kidlib/p2p/solid';

type Props = {
  roomId?: string | null;
  memberCount: number;
  memberCapacity?: number;
  status: RoomStatusType;
  error?: string;
};

export type RoomStatusType = SolidP2PRoomState;

export default function RoomStatus(props: Props) {
  return (
    <div class='room-status'>
      <p>
        Members: {props.memberCount}
        <Show when={props.memberCapacity != null}>
          {(capacity) => <> / {capacity()}</>}
        </Show>
      </p>
      <p>Room status: {props.status}</p>
      <Show when={props.roomId}>
        <p>Room ID: {props.roomId}</p>
      </Show>
      <Show when={props.error}>
        <p>{props.error}</p>
      </Show>
    </div>
  );
}
