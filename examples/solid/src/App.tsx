import { createSignal } from 'solid-js';
import ComponentRoom from './ComponentRoomExample/ComponentRoom';

import {
  createBroadcastRoomSignaling,
  createWebSocketRoomSignaling,
} from '@shared/index';

export default function App() {
  const [signalingMethod, setSignalingMethod] = createSignal('broadcast');

  const createSignaling = ({ roomId }: { roomId: string }) => {
    if (signalingMethod() === 'websocket') {
      return createWebSocketRoomSignaling({
        url: 'ws://localhost:8080',
        roomId,
      });
    }
    return createBroadcastRoomSignaling(roomId);
  };

  return (
    <div class='app'>
      <div
        class='top-bar'
        style='display: flex; gap: 0.5rem; padding: 0.5rem; margin-bottom: 2rem; background: #eee;'
      >
        <div
          class='select-signaling-section'
          style='display: flex; align-items: center; gap: 0.5rem;'
        >
          <span class='select-signaling-label'>Select Signaling Method:</span>
          <select
            title='Select Signaling Method'
            class='select-signaling'
            onChange={(e) => setSignalingMethod(e.currentTarget.value)}
          >
            <option value='broadcast'>BroadcastChannel</option>
            <option value='websocket'>WebSocket</option>
          </select>
        </div>
      </div>
      <ComponentRoom createSignaling={createSignaling} />
    </div>
  );
}
