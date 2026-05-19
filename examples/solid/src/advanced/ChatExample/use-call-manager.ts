import { createEffect, createSignal, onCleanup } from 'solid-js';
import type { SolidP2PRoom } from '@kidlib/p2p/solid';
import type { InvitationSignaling } from './chat.signaling';
import {
  chatState as defaultChatState,
  setChatState,
  type ChatStateStore,
} from './chat.state';
import { createChatActions, type ChatActions } from './chat.actions';
import { createBrowserMeshRoomSignaling } from './demo.adapters';

type CallManagerOptions = {
  enabled: boolean;
  callSignaling?: InvitationSignaling;
  store?: ChatStateStore;
  actions?: ChatActions;
};

export function useCallManager(p2p: SolidP2PRoom, options?: CallManagerOptions) {
  const store: ChatStateStore =
    options?.store ?? { state: defaultChatState, setState: setChatState };
  const chatState = store.state;
  const actions: ChatActions = options?.actions ?? createChatActions(store);
  const [isPendingCallResponse, setIsPendingCallResponse] = createSignal(false);
  const [pendingCallRoomId, setPendingCallRoomId] = createSignal<string | null>(null);
  const [incomingCallInvite, setIncomingCallInvite] = createSignal<{
    from: string;
    callRoomId: string;
  } | null>(null);

  // Listen for incoming call invitations via the app-level signaling channel
  createEffect(() => {
    if (!options?.enabled || !options.callSignaling) return;
    const roomId = chatState.roomId;
    const peerId = chatState.peerId;
    if (!roomId || !peerId) return;

    const callSignaling = options.callSignaling;
    const subscribeResult = callSignaling.subscribe(roomId, peerId, {
      onRequest: (fromPeerId, callRoomId) => {
        setIncomingCallInvite({ from: fromPeerId, callRoomId });
      },
      onCancel: () => {
        setIncomingCallInvite(null);
      },
      onResponse: (accepted) => {
        setIsPendingCallResponse(false);
        if (accepted) {
          const callRoomId = pendingCallRoomId();
          if (callRoomId) void joinCallRoom(callRoomId);
        } else {
          setPendingCallRoomId(null);
          actions.addSystemMessage('Call declined');
        }
      },
    });

    if (typeof subscribeResult === 'function') {
      onCleanup(subscribeResult);
    } else {
      let cleanup: (() => void) | undefined;
      let disposed = false;
      void subscribeResult.then((resolved) => {
        if (disposed) {
          resolved();
        } else {
          cleanup = resolved;
        }
      });
      onCleanup(() => {
        disposed = true;
        cleanup?.();
      });
    }
  });

  async function joinCallRoom(callRoomId: string) {
    const peerId = chatState.peerId;
    if (!peerId) return;
    await p2p.join({
      roomId: callRoomId,
      peerId,
      createSignaling: ({ roomId }) => createBrowserMeshRoomSignaling(roomId),
      getLocalStream: () =>
        navigator.mediaDevices.getUserMedia({ video: true, audio: false }),
      dataChannel: true,
    });
    setPendingCallRoomId(null);
  }

  function startCall() {
    const roomId = chatState.roomId;
    const peerId = chatState.peerId;
    if (!roomId || !peerId) return;
    const callRoomId = crypto.randomUUID();
    void options?.callSignaling?.send(roomId, peerId, callRoomId);
    void joinCallRoom(callRoomId);
  }

  function cancelCall() {
    const roomId = chatState.roomId;
    if (!roomId) return;
    setIsPendingCallResponse(false);
    void options?.callSignaling?.cancel(roomId);
    setPendingCallRoomId(null);
  }

  async function acceptCall() {
    const call = incomingCallInvite();
    if (!call) return;
    setIncomingCallInvite(null);
    await joinCallRoom(call.callRoomId);
  }

  function declineCall() {
    const call = incomingCallInvite();
    if (!call) return;
    setIncomingCallInvite(null);
  }

  async function endCall() {
    await p2p.leave();
  }

  return {
    incomingCallInvite,
    isPendingCallResponse,
    startCall,
    cancelCall,
    acceptCall,
    declineCall,
    endCall,
  };
}
