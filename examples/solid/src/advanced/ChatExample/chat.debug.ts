import { untrack } from 'solid-js';
import {
  chatState,
  type ChatStateStore,
  type Message,
  type TransportMode,
} from './chat.state';

export type ChatDebugSnapshot = {
  roomId: string | null;
  peerId: string | null;
  draftLength: number;
  sending: boolean;
  transportMode: TransportMode;
  isPendingPrivateResponse: boolean;
  messageCount: number;
  lastMessages: Pick<Message, 'id' | 'senderId' | 'status' | 'source'>[];
};

export type ChatDebugEvent = {
  type: string;
  detail?: Record<string, unknown>;
  state: ChatDebugSnapshot;
};

export type ChatDebugMode = boolean | ((event: ChatDebugEvent) => void);

let debugMode: ChatDebugMode | undefined = false;

export function configureChatDebug(mode: ChatDebugMode | undefined) {
  debugMode = mode;
}

export function logChatDebug(
  type: string,
  detail?: Record<string, unknown>,
  store?: ChatStateStore,
) {
  if (!debugMode) return;

  const event: ChatDebugEvent = {
    type,
    ...(detail ? { detail } : {}),
    state: getChatDebugSnapshot(store),
  };

  if (typeof debugMode === 'function') {
    debugMode(event);
    return;
  }

  console.debug('[ChatExample]', event.type, event);
}

function getChatDebugSnapshot(store?: ChatStateStore): ChatDebugSnapshot {
  const state = store?.state ?? chatState;
  return untrack(() => ({
    roomId: state.roomId,
    peerId: state.peerId,
    draftLength: state.draft.length,
    sending: state.sending,
    transportMode: state.transportMode,
    isPendingPrivateResponse: state.isPendingPrivateResponse,
    messageCount: state.messages.length,
    lastMessages: state.messages.slice(-5).map((message) => ({
      id: message.id,
      senderId: message.senderId,
      status: message.status,
      source: message.source,
    })),
  }));
}
