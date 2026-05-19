import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import ComponentRoom from './ComponentRoomExample/ComponentRoom';
import { ChatRoom } from './advanced/ChatExample';
import {
  createBrowserMeshPrivateRoom,
  createWebSocketInvitationSignaling,
  localStorageCallSignaling,
  localStoragePrivateSignaling,
  localStorageTransport,
} from './advanced/ChatExample/demo.adapters';
import {
  createBroadcastRoomSignaling,
  createWebSocketRoomSignaling,
} from '@shared/index';

type DemoMode = 'component-room' | 'chat';
type SignalingMethod = 'local' | 'websocket';
const DEMO_ROOM_ID = 'demo-room';
const DEMO_PEERS = ['alice', 'bob', 'charlie'] as const;
const WS_SIGNALING_URL = 'ws://localhost:8080';
const DEMO_MODE_KEY = 'kidlib:demo:mode';
const SIGNALING_METHOD_KEY = 'kidlib:demo:signaling-method';
type DemoPeerId = (typeof DEMO_PEERS)[number];

const isDemoMode = (value: unknown): value is DemoMode =>
  value === 'component-room' || value === 'chat';
const isSignalingMethod = (value: unknown): value is SignalingMethod =>
  value === 'local' || value === 'websocket';

function readPersisted<T>(key: string, guard: (v: unknown) => v is T, fallback: T): T {
  const stored = localStorage.getItem(key);
  return stored != null && guard(stored) ? stored : fallback;
}

export default function App() {
  const [demoMode, setDemoMode] = createSignal<DemoMode>(
    readPersisted(DEMO_MODE_KEY, isDemoMode, 'component-room'),
  );
  const [signalingMethod, setSignalingMethod] = createSignal<SignalingMethod>(
    readPersisted(SIGNALING_METHOD_KEY, isSignalingMethod, 'local'),
  );
  const [peerId, setPeerId] = createSignal<DemoPeerId | null>(null);

  createEffect(() => localStorage.setItem(DEMO_MODE_KEY, demoMode()));
  createEffect(() =>
    localStorage.setItem(SIGNALING_METHOD_KEY, signalingMethod()),
  );

  const createSignaling = ({ roomId }: { roomId: string }) => {
    if (signalingMethod() === 'websocket') {
      return createWebSocketRoomSignaling({
        url: WS_SIGNALING_URL,
        roomId,
      });
    }
    return createBroadcastRoomSignaling(roomId);
  };

  const privateInvitationSignaling = createMemo(() =>
    signalingMethod() === 'websocket'
      ? createWebSocketInvitationSignaling({
          url: WS_SIGNALING_URL,
          topic: 'private',
        })
      : localStoragePrivateSignaling,
  );

  const callInvitationSignaling = createMemo(() =>
    signalingMethod() === 'websocket'
      ? createWebSocketInvitationSignaling({
          url: WS_SIGNALING_URL,
          topic: 'call',
        })
      : localStorageCallSignaling,
  );

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
            value={demoMode()}
            onChange={(e) => setDemoMode(e.currentTarget.value as DemoMode)}
          >
            <option value='component-room'>Component Room</option>
            <option value='chat'>Chat Example</option>
          </select>
        </div>
        <div
          class='select-signaling-section'
          style='display: flex; align-items: center; gap: 0.5rem;'
        >
          <span class='select-signaling-label'>Select Signaling Method:</span>
          <select
            title='Select Signaling Method'
            class='select-signaling'
            value={signalingMethod()}
            onChange={(e) =>
              setSignalingMethod(e.currentTarget.value as SignalingMethod)
            }
          >
            <option value='local'>Local</option>
            <option value='websocket'>WebSocket</option>
          </select>
        </div>
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
                signaling: privateInvitationSignaling(),
                createRoom: createBrowserMeshPrivateRoom,
              }}
              demoCallSignaling={callInvitationSignaling()}
              debugMode={true}
              createRtcSignaling={createSignaling}
            />
          )}
        </Show>
      </Show>
    </div>
  );
}
