import { createSignal } from 'solid-js';
import type { RoomStatusType } from './RoomStatus';

type Props = {
  status: RoomStatusType;
  onEnterRoom: (roomId: string) => void | Promise<void>;
  onLeaveRoom: () => void | Promise<void>;
};

export default function LobbyForm(props: Props) {
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

  async function enterRoomAndUpdateURL() {
    const id = enteredRoomId();
    if (!id) return;

    const url = new URL(window.location.href);
    url.searchParams.set('room', id);
    window.history.replaceState(null, '', url);

    await props.onEnterRoom(id);
  }

  async function leaveRoomAndUpdateURL() {
    await props.onLeaveRoom();

    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState(null, '', url);
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
    <form
      class='lobby-form'
      onSubmit={(e) => {
        e.preventDefault();
        void enterRoomAndUpdateURL();
      }}
    >
      <input
        class='room-id-input'
        value={roomId()}
        onInput={(event) => setRoomId(event.currentTarget.value)}
        placeholder='Room ID'
        aria-label='Room ID'
        disabled={isLoading()}
      />
      <button type='submit' class='primary-button' disabled={!canUseRoom()}>
        {isJoining() ? 'Entering...' : 'Enter room'}
      </button>
      <button type='button' onClick={copyLink} disabled={!canCopyLink()}>
        Copy link
      </button>
      <button
        type='button'
        onClick={leaveRoomAndUpdateURL}
        disabled={!isJoined() || isLeaving()}
      >
        Leave room
      </button>
    </form>
  );
}
