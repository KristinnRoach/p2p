import {
  chatState,
  setChatState,
  type ChatStateStore,
  type Message,
  type MessageAction,
  type TransportMode,
} from './chat.state';
import { logChatDebug } from './chat.debug';

export function createChatActions(store: ChatStateStore) {
  const { state, setState } = store;

  function setDraft(text: string) {
    setState('draft', text);
  }

  function openRoom(roomId: string, peerId: string) {
    setState('roomId', roomId);
    setState('peerId', peerId);
    setState('messages', []);
    setState('transportMode', 'persisted');
    setState('isPendingPrivateResponse', false);
    logChatDebug('state:open-room', { roomId, peerId }, store);
  }

  function addOptimisticMessage(message: Message) {
    setState('messages', (msgs) => [...msgs, message]);
    logChatDebug(
      'state:add-optimistic-message',
      {
        id: message.id,
        source: message.source,
        status: message.status,
      },
      store,
    );
  }

  function receiveMessage(message: Omit<Message, 'status'>) {
    const idx = state.messages.findIndex((m: Message) => m.id === message.id);
    const nextMessage = { ...message, status: 'sent' as const };
    if (idx === -1) {
      setState('messages', (msgs) => [...msgs, nextMessage]);
    } else {
      setState('messages', idx, nextMessage);
    }
    logChatDebug(
      'state:receive-message',
      {
        id: message.id,
        source: message.source,
        senderId: message.senderId,
      },
      store,
    );
  }

  function addSystemMessage(
    text: string,
    actions?: MessageAction[],
  ): string {
    const id = crypto.randomUUID();
    setState('messages', (msgs) => [
      ...msgs,
      {
        id,
        text,
        senderId: 'system',
        createdAt: Date.now(),
        status: 'sent' as const,
        source: 'system' as const,
        ...(actions ? { actions } : {}),
      },
    ]);
    logChatDebug(
      'state:add-system-message',
      {
        id,
        hasActions: Boolean(actions?.length),
      },
      store,
    );
    return id;
  }

  function clearMessageActions(id: string) {
    const idx = state.messages.findIndex((m: Message) => m.id === id);
    if (idx !== -1) setState('messages', idx, 'actions', []);
  }

  function removeMessage(id: string) {
    setState('messages', (msgs) => msgs.filter((m) => m.id !== id));
    logChatDebug('state:remove-message', { id }, store);
  }

  function removeSystemMessage(id: string) {
    const idx = state.messages.findIndex(
      (m: Message) => m.id === id && m.source === 'system',
    );
    if (idx !== -1)
      setState('messages', (msgs) => msgs.filter((m) => m.id !== id));
    logChatDebug(
      'state:remove-system-message',
      { id, removed: idx !== -1 },
      store,
    );
  }

  function markMessageSent(tempId: string, realId: string) {
    setState('messages', (msg) => msg.id === tempId, 'id', realId);
    setState(
      'messages',
      (msg) => msg.id === realId,
      'status',
      'sent',
    );
    logChatDebug('state:mark-message-sent', { tempId, realId }, store);
  }

  function markMessageFailed(tempId: string) {
    setState('messages', (msg) => msg.id === tempId, 'status', 'failed');
    logChatDebug('state:mark-message-failed', { tempId }, store);
  }

  function setSending(value: boolean) {
    setState('sending', value);
    logChatDebug('state:set-sending', { value }, store);
  }

  function clearDraft() {
    setState('draft', '');
    logChatDebug('state:clear-draft', undefined, store);
  }

  function setTransportMode(mode: TransportMode) {
    setState('transportMode', mode);
    logChatDebug('state:set-transport-mode', { mode }, store);
  }

  function setIsPendingPrivateResponse(value: boolean) {
    setState('isPendingPrivateResponse', value);
    logChatDebug('state:set-pending-private-response', { value }, store);
  }

  return {
    setDraft,
    openRoom,
    addOptimisticMessage,
    receiveMessage,
    addSystemMessage,
    clearMessageActions,
    removeMessage,
    removeSystemMessage,
    markMessageSent,
    markMessageFailed,
    setSending,
    clearDraft,
    setTransportMode,
    setIsPendingPrivateResponse,
  };
}

export type ChatActions = ReturnType<typeof createChatActions>;

const defaultChatActions = createChatActions({
  state: chatState,
  setState: setChatState,
});

export const {
  setDraft,
  openRoom,
  addOptimisticMessage,
  receiveMessage,
  addSystemMessage,
  clearMessageActions,
  removeMessage,
  removeSystemMessage,
  markMessageSent,
  markMessageFailed,
  setSending,
  clearDraft,
  setTransportMode,
  setIsPendingPrivateResponse,
} = defaultChatActions;
