import type { RoomStatus } from '../mesh-room/roomTypes';

type Props = {
  status: RoomStatus;
  isJoining: boolean;
  isJoined: boolean;
  onStart: () => void | Promise<void>;
  onLeave: () => void | Promise<void>;
};

export function RoomToolbar(props: Props) {
  return (
    <div>
      <button onClick={props.onStart} disabled={props.isJoining || props.isJoined}>
        {props.isJoining ? 'Starting...' : 'Start room'}
      </button>
      <button onClick={props.onLeave} disabled={!props.isJoined}>
        Leave room
      </button>
      <span>{props.status}</span>
    </div>
  );
}
