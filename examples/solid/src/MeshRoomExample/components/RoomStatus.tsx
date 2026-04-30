import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import type { P2PRoom } from '@kidlib/p2p';
import type { RoomStatus as RoomStatusValue } from '../types';

type Props = {
  room?: P2PRoom;
  status: RoomStatusValue;
  error?: string;
};

export default function RoomStatus(props: Props) {
  const [memberCount, setMemberCount] = createSignal(0);
  const [memberCapacity, setMemberCapacity] = createSignal<number>();
  const [roomId, setRoomId] = createSignal<string>();

  createEffect(() => {
    const room = props.room;
    if (!room || !room.roomId) {
      setMemberCount(0);
      setMemberCapacity(undefined);
      setRoomId(undefined);
      return;
    }

    setRoomId(room.roomId);
    setMemberCount(room.memberCount);
    setMemberCapacity(room.memberCapacity);

    const cleanups = [
      room.on('membersChanged', ({ memberCount, memberCapacity }) => {
        setMemberCount(memberCount);
        setMemberCapacity(memberCapacity);
      }),
    ];

    onCleanup(() => cleanups.forEach((cleanup) => cleanup()));
  });

  return (
    <div class='room-status'>
      <p>
        Members: {memberCount()} / {memberCapacity()}
      </p>
      <Show when={roomId()}>
        <p>Room ID: {roomId()}</p>
      </Show>
      <Show when={props.status === 'full'}>
        <p>Room is full.</p>
      </Show>
      <Show when={props.error && props.status !== 'full'}>
        <p>{props.error}</p>
      </Show>
    </div>
  );
}
