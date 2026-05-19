import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createChatState,
  chatState,
  setChatState,
} from '../examples/solid/src/advanced/ChatExample/chat.state';
import { createChatActions } from '../examples/solid/src/advanced/ChatExample/chat.actions';
import { loadMessages } from '../examples/solid/src/advanced/ChatExample/chat.service';
import { useChatTransport } from '../examples/solid/src/advanced/ChatExample/use-chat-transport';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFakePrivateRoom() {
  const target = new EventTarget();
  return {
    broadcast: vi.fn(),
    close: vi.fn(),
    on(type, callback) {
      const listener = (event) => callback(event.detail, event);
      target.addEventListener(type, listener);
      return () => target.removeEventListener(type, listener);
    },
    emit(type, detail = {}) {
      target.dispatchEvent(new CustomEvent(type, { detail }));
    },
  };
}

function createConfig(overrides = {}) {
  return {
    roomId: 'room-a',
    peerId: 'peer-a',
    messageTransport: {
      loadMessages: vi.fn(() => []),
      send: vi.fn(async () => ({ id: 'saved-a', createdAt: Date.now() })),
      subscribe: vi.fn(() => () => {}),
      clear: vi.fn(),
    },
    privateChat: {
      signaling: {
        send: vi.fn(),
        respond: vi.fn(),
        cancel: vi.fn(),
        subscribe: vi.fn(() => () => {}),
      },
      createRoom: vi.fn(),
    },
    ...overrides,
  };
}

function resetChatState() {
  setChatState({
    roomId: 'room-a',
    peerId: 'peer-a',
    draft: '',
    messages: [],
    sending: false,
    transportMode: 'persisted',
    isPendingPrivateResponse: false,
  });
}

describe('ChatExample private transport lifecycle', () => {
  beforeEach(() => {
    resetChatState();
  });

  it('does not enter private mode when a canceled private room resolves late', async () => {
    const privateRoomReady = deferred();
    const privateRoom = createFakePrivateRoom();
    const config = createConfig({
      privateChat: {
        ...createConfig().privateChat,
        createRoom: vi.fn(() => privateRoomReady.promise),
      },
    });

    let transport;
    const dispose = createRoot((dispose) => {
      transport = useChatTransport(config);
      return dispose;
    });

    try {
      await transport.requestPrivate();
      expect(chatState.isPendingPrivateResponse).toBe(true);
      expect(config.privateChat.createRoom).toHaveBeenCalledOnce();
      expect(chatState.messages.map((message) => message.text)).toEqual([
        'Waiting for peer...',
        'Creating private connection...',
      ]);

      await transport.requestPrivate();
      expect(config.privateChat.signaling.cancel).toHaveBeenCalledWith('room-a');
      expect(chatState.transportMode).toBe('persisted');
      expect(chatState.isPendingPrivateResponse).toBe(false);
      expect(chatState.messages.map((message) => message.text)).toEqual([]);

      privateRoomReady.resolve(privateRoom);
      await privateRoomReady.promise;
      privateRoom.emit('dataChannelOpen');

      expect(chatState.transportMode).toBe('persisted');
      expect(chatState.isPendingPrivateResponse).toBe(false);
      expect(privateRoom.close).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it('marks a private message failed when no private route exists', async () => {
    const store = createChatState();
    const actions = createChatActions(store);
    const config = createConfig();

    let transport;
    const dispose = createRoot((dispose) => {
      transport = useChatTransport(config, store, actions);
      return dispose;
    });

    try {
      actions.openRoom('room-a', 'peer-a');
      actions.setTransportMode('private');
      actions.setDraft('secret');

      await transport.send();

      expect(config.messageTransport.send).not.toHaveBeenCalled();
      expect(store.state.messages).toHaveLength(1);
      expect(store.state.messages[0]).toMatchObject({
        text: 'secret',
        source: 'private',
        status: 'failed',
      });
      expect(store.state.sending).toBe(false);
    } finally {
      dispose();
    }
  });

  it('ignores stale message loads after the active room changes', async () => {
    const store = createChatState();
    const actions = createChatActions(store);
    const roomA = deferred();
    const configA = createConfig({
      roomId: 'room-a',
      messageTransport: {
        ...createConfig().messageTransport,
        loadMessages: vi.fn(() => roomA.promise),
      },
    });
    const configB = createConfig({
      roomId: 'room-b',
      messageTransport: {
        ...createConfig().messageTransport,
        loadMessages: vi.fn(() => [
          {
            id: 'b-1',
            text: 'current',
            senderId: 'peer-b',
            createdAt: 2,
          },
        ]),
      },
    });

    let version = 0;
    const firstVersion = ++version;
    const firstLoad = loadMessages(
      configA,
      store,
      actions,
      () => firstVersion === version,
    );

    const secondVersion = ++version;
    await loadMessages(
      configB,
      store,
      actions,
      () => secondVersion === version,
    );

    roomA.resolve([
      {
        id: 'a-1',
        text: 'stale',
        senderId: 'peer-a',
        createdAt: 1,
      },
    ]);
    await firstLoad;

    expect(store.state.roomId).toBe('room-b');
    expect(store.state.messages).toHaveLength(1);
    expect(store.state.messages[0]).toMatchObject({
      id: 'b-1',
      text: 'current',
    });
  });

  it('cleans subscriptions and the private room on dispose', async () => {
    const unsubscribeMessages = vi.fn();
    const unsubscribePrivate = vi.fn();
    const privateRoom = createFakePrivateRoom();
    const config = createConfig({
      messageTransport: {
        ...createConfig().messageTransport,
        subscribe: vi.fn(() => unsubscribeMessages),
      },
      privateChat: {
        ...createConfig().privateChat,
        signaling: {
          ...createConfig().privateChat.signaling,
          subscribe: vi.fn(() => unsubscribePrivate),
        },
        createRoom: vi.fn(async () => privateRoom),
      },
    });

    let transport;
    const dispose = createRoot((dispose) => {
      transport = useChatTransport(config);
      return dispose;
    });

    try {
      await transport.requestPrivate();
      await Promise.resolve();
      privateRoom.emit('dataChannelOpen');
      expect(chatState.transportMode).toBe('private');
    } finally {
      dispose();
    }

    expect(unsubscribeMessages).toHaveBeenCalledOnce();
    expect(unsubscribePrivate).toHaveBeenCalledOnce();
    expect(privateRoom.close).toHaveBeenCalledOnce();
  });

  it('keeps chat state isolated per store instance', () => {
    const aliceStore = createChatState();
    const bobStore = createChatState();
    const aliceActions = createChatActions(aliceStore);
    const bobActions = createChatActions(bobStore);

    aliceActions.openRoom('room-a', 'alice');
    aliceActions.setDraft('from alice');
    bobActions.openRoom('room-b', 'bob');
    bobActions.setDraft('from bob');

    expect(aliceStore.state).toMatchObject({
      roomId: 'room-a',
      peerId: 'alice',
      draft: 'from alice',
    });
    expect(bobStore.state).toMatchObject({
      roomId: 'room-b',
      peerId: 'bob',
      draft: 'from bob',
    });
  });
});
