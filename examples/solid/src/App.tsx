import { createSignal, For, Show } from 'solid-js';
import ComponentRoom from './ComponentRoomExample/ComponentRoom';
import { ChatRoom } from './advanced/ChatExample';
import {
  createBrowserMeshPrivateRoom,
  localStorageCallSignaling,
  localStoragePrivateSignaling,
  localStorageTransport,
} from './advanced/ChatExample/demo.adapters';
import {
  createBroadcastRoomSignaling,
  createWebSocketRoomSignaling,
} from '@shared/index';

type DemoMode = 'component-room' | 'chat';
const DEMO_ROOM_ID = 'demo-room';
const DEMO_PEERS = ['alice', 'bob', 'charlie'] as const;
type DemoPeerId = (typeof DEMO_PEERS)[number];

export default function App() {
  const [demoMode, setDemoMode] = createSignal<DemoMode>('component-room');
  const [signalingMethod, setSignalingMethod] = createSignal('broadcast');
  const [peerId, setPeerId] = createSignal<DemoPeerId | null>(null);

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
          class='select-demo-section'
          style='display: flex; align-items: center; gap: 0.5rem;'
        >
          <span>Demo:</span>
          <select
            title='Select Demo'
            onChange={(e) => setDemoMode(e.currentTarget.value as DemoMode)}
          >
            <option value='component-room'>Component Room</option>
            <option value='chat'>Chat Example</option>
          </select>
        </div>
        <Show when={demoMode() === 'component-room'}>
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
        </Show>
      </div>

      <Show when={demoMode() === 'component-room'}>
        <ComponentRoom createSignaling={createSignaling} />
      </Show>

      <Show when={demoMode() === 'chat'}>
        <Show
          when={peerId()}
          fallback={
            <section class='lobby-container'>
              <h2>Join chat as</h2>
              <div class='select-identity'>
                <For each={DEMO_PEERS}>
                  {(demoPeerId) => (
                    <button
                      type='button'
                      class='button chat-join'
                      onClick={() => setPeerId(demoPeerId)}
                    >
                      {demoPeerId}
                    </button>
                  )}
                </For>
              </div>
            </section>
          }
        >
          {(activePeerId) => (
            <ChatRoom
              roomId={DEMO_ROOM_ID}
              peerId={activePeerId()}
              messageTransport={localStorageTransport}
              privateChat={{
                signaling: localStoragePrivateSignaling,
                createRoom: createBrowserMeshPrivateRoom,
              }}
              demoCallSignaling={localStorageCallSignaling}
              debugMode={true}
            />
          )}
        </Show>
      </Show>
    </div>
  );
}
