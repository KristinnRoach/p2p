import { chatState, setChatState, type ChatStateStore } from './chat.state';
import type { Message } from './chat.state';
import { createChatActions } from './chat.actions';
import type { ChatActions } from './chat.actions';
import type { ChatExampleConfig } from './chat.types';
import { configureChatDebug, logChatDebug } from './chat.debug';

export async function loadMessages(
  config: ChatExampleConfig,
  store: ChatStateStore = { state: chatState, setState: setChatState },
  actions: ChatActions = createChatActions(store),
  shouldApply: () => boolean = () => true,
) {
  configureChatDebug(config.debugMode);
  actions.openRoom(config.roomId, config.peerId);
  const messages = await config.messageTransport.loadMessages(config.roomId);
  if (!shouldApply()) {
    logChatDebug(
      'state:load-messages-stale',
      { loadedCount: messages.length },
      store,
    );
    return;
  }
  store.setState(
    'messages',
    messages.map(
      (msg): Message => ({
        ...msg,
        status: 'sent',
        source: 'persisted',
      }),
    ),
  );
  logChatDebug('state:load-messages', { loadedCount: messages.length }, store);
}
