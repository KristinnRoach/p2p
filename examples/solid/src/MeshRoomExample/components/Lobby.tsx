import { createSignal } from 'solid-js';
import type { RoomStatus } from '../types';

type Props = {
  status: RoomStatus;
  onEnterRoom: (roomId: string) => void | Promise<void>;
  onLeaveRoom: () => void | Promise<void>;
};

export default function Lobby(props: Props) {
  const initialRoomId =
    new URL(window.location.href).searchParams.get('room')?.trim() ?? '';
  const [roomId, setRoomId] = createSignal(initialRoomId);
  const isJoining = () => props.status === 'joining';
  const isJoined = () => props.status === 'joined';
  const isLeaving = () => props.status === 'leaving';
  const isLoading = () => isJoining() || isJoined() || isLeaving();
  const enteredRoomId = () => roomId().trim();
  const canUseRoom = () => enteredRoomId().length > 0 && !isLoading();
  const canCopyLink = () => enteredRoomId().length > 0;

  async function enterRoom() {
    const id = enteredRoomId();
    if (!id) return;

    const url = new URL(window.location.href);
    url.searchParams.set('room', id);
    window.history.replaceState(null, '', url);

    await props.onEnterRoom(id);
  }

  async function copyLink() {
    const id = enteredRoomId();
    if (!id) return;

    const url = new URL(window.location.href);
    url.searchParams.set('room', id);

    try {
      await navigator.clipboard.writeText(url.toString());
    } catch (err) {
      console.warn('Could not copy room link to clipboard', err);
    }
  }

  return (
    <div class='toolbar'>
      <input
        class='room-id-input'
        value={roomId()}
        onInput={(event) => setRoomId(event.currentTarget.value)}
        placeholder='Room ID'
        disabled={isLoading()}
      />
      <button
        class='primary-button'
        onClick={enterRoom}
        disabled={!canUseRoom()}
      >
        {isJoining() ? 'Entering...' : 'Enter room'}
      </button>
      <button onClick={copyLink} disabled={!canCopyLink()}>
        Copy link
      </button>
      <button
        onClick={props.onLeaveRoom}
        disabled={!isJoined() || isLeaving()}
      >
        Leave room
      </button>
      <span class='status-pill'>{props.status}</span>
    </div>
  );
}
