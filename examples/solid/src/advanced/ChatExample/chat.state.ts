import { createStore, type SetStoreFunction } from 'solid-js/store';

export type MessageSource = 'persisted' | 'private' | 'system';

export type MessageAction = { label: string; onClick: () => void };

export type Message = {
  id: string;
  text: string;
  senderId: string;
  createdAt: number;
  status: 'sending' | 'sent' | 'failed';
  source: MessageSource;
  actions?: MessageAction[];
};

export type TransportMode = 'persisted' | 'private';

export type ChatState = {
  roomId: string | null;
  peerId: string | null;
  draft: string;
  messages: Message[];
  sending: boolean;
  transportMode: TransportMode;
  isPendingPrivateResponse: boolean;
};

export const initialChatState: ChatState = {
  roomId: null,
  peerId: null,
  draft: '',
  messages: [],
  sending: false,
  transportMode: 'persisted',
  isPendingPrivateResponse: false,
};

export type ChatStateStore = {
  state: ChatState;
  setState: SetStoreFunction<ChatState>;
};

export function createChatState(): ChatStateStore {
  const [state, setState] = createStore<ChatState>({ ...initialChatState });
  return { state, setState };
}

const defaultChatStore = createChatState();

export const chatState = defaultChatStore.state;
export const setChatState = defaultChatStore.setState;
