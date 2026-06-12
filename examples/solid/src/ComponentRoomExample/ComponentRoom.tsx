import {
  P2PRoom,
  P2PRoomControls,
  P2PRoomStatus,
  P2PVideoGrid,
  P2PChat,
} from '@kidlib/p2p/components/solid';

import { setLogger } from '@kidlib/p2p';

type ComponentRoomProps = {
  createSignaling: (options: { roomId: string }) => any;
};

export default function ComponentRoom(props: ComponentRoomProps) {
  setLogger((...args) => {
    console.info('[P2P] Component room...', ...args);
  });

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
        <P2PChat maxMessages={3} />
      </P2PRoom>
    </div>
  );
}
