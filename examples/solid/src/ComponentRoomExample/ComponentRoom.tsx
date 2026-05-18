import { createBrowserMeshRoomSignaling } from '@shared/index';
import { defineP2PComponents } from '@kidlib/p2p/components/solid';

defineP2PComponents({ createSignaling: createBrowserMeshRoomSignaling });

export default function ComponentRoom() {
  return (
    <div class='example'>
      <p2p-room room-id='demo-room' member-capacity='6'>
        <p2p-room-controls></p2p-room-controls>
        <p2p-room-status></p2p-room-status>
        <p2p-video-grid></p2p-video-grid>
        <p2p-chat></p2p-chat>
      </p2p-room>
    </div>
  );
}
