import type { RoomStatus } from '../mesh-room/roomTypes';

type Props = {
  status: RoomStatus;
  isJoining: boolean;
  isJoined: boolean;
  isLeaving: boolean;
  onStart: () => void | Promise<void>;
  onLeave: () => void | Promise<void>;
};

export function RoomToolbar(props: Props) {
  return (
    <div class="toolbar">
      <button
        onClick={props.onStart}
        disabled={props.isJoining || props.isJoined || props.isLeaving}
      >
        {props.isJoining ? 'Starting...' : 'Start room'}
      </button>
      <button
        onClick={props.onLeave}
        disabled={!props.isJoined || props.isLeaving}
      >
        Leave room
      </button>
      <span class="status-pill">{props.status}</span>
    </div>
  );
}
