import {
  P2PRoom,
  P2PRoomControls,
  P2PRoomStatus,
  P2PVideoGrid,
  P2PChat,
} from '@kidlib/p2p/components/solid';

type ComponentRoomProps = {
  createSignaling: (options: { roomId: string }) => any;
};

export default function ComponentRoom(props: ComponentRoomProps) {
  return (
    <div class='example'>
      <P2PRoom
        roomId='demo-room'
        memberCapacity={6}
        createSignaling={props.createSignaling}
      >
        <P2PRoomControls />
        <P2PRoomStatus />
        <P2PVideoGrid />
        <P2PChat maxMessages={10} />
      </P2PRoom>
    </div>
  );
}
