import { createEffect, onCleanup, type Accessor } from 'solid-js';
import type { P2PRoom } from '@kidlib/p2p';
import type { ChatExampleConfig, PrivateChatConfig } from './chat.types';
import type { P2PChatEnvelope } from './chat.transport';
import {
  chatState as defaultChatState,
  setChatState,
  type ChatStateStore,
} from './chat.state';
import { configureChatDebug, logChatDebug } from './chat.debug';
import { createChatActions, type ChatActions } from './chat.actions';

export function useChatTransport(
  config: ChatExampleConfig | Accessor<ChatExampleConfig>,
  store: ChatStateStore = { state: defaultChatState, setState: setChatState },
  actions: ChatActions = createChatActions(store),
) {
  const getConfig =
    typeof config === 'function'
      ? (config as Accessor<ChatExampleConfig>)
      : () => config;
  const chatState = store.state;
  const {
    addOptimisticMessage,
    addSystemMessage,
    clearDraft,
    markMessageFailed,
    markMessageSent,
    receiveMessage,
    removeSystemMessage,
    setIsPendingPrivateResponse,
    setSending,
    setTransportMode,
  } = actions;
  let privateRoom: P2PRoom | null = null;
  let privateRoomMsgCleanup: (() => void) | null = null;
  let lastConnectingMsgId: string | null = null;
  let lastWaitingMsgId: string | null = null;
  let privateRoomAttempt = 0;

  function getPrivateChat(): PrivateChatConfig | undefined {
    return getConfig().privateChat;
  }

  createEffect(() => {
    configureChatDebug(getConfig().debugMode);
  });

  function clearPendingPrivateMessages() {
    if (lastWaitingMsgId) {
      removeSystemMessage(lastWaitingMsgId);
      lastWaitingMsgId = null;
    }
    if (lastConnectingMsgId) {
      removeSystemMessage(lastConnectingMsgId);
      lastConnectingMsgId = null;
    }
  }

  function bindPrivateRoomMessages(room: P2PRoom) {
    privateRoomMsgCleanup?.();
    privateRoomMsgCleanup = room.on('dataChannelMessage', ({ data }) => {
      handleDataChannelMessage(data as string);
    });
  }

  function handleCallMessage(data: string) {
    handleDataChannelMessage(data);
  }

  function handleDataChannelMessage(data: string) {
    let envelope: P2PChatEnvelope;
    try {
      envelope = JSON.parse(data) as P2PChatEnvelope;
    } catch {
      logChatDebug(
        'transport:ignore-invalid-data-channel-message',
        undefined,
        store,
      );
      return;
    }
    if (envelope?.type !== 'chat') return;
    logChatDebug(
      'transport:receive-private-message',
      { id: envelope.id },
      store,
    );
    receiveMessage({ ...envelope, source: 'private' });
  }

  async function joinPrivateRoom(privateRoomId: string) {
    const current = getConfig();
    const privateChat = getPrivateChat();
    if (!current.peerId || !privateChat) {
      logChatDebug(
        'private:join-skipped',
        { reason: 'missing-private-chat-or-peer-id' },
        store,
      );
      return;
    }

    const attempt = privateRoomAttempt;
    logChatDebug('private:join-start', { privateRoomId }, store);
    lastConnectingMsgId = addSystemMessage('Creating private connection...');
    try {
      const room = await privateChat.createRoom({
        roomId: privateRoomId,
        peerId: current.peerId,
        createRtcSignaling: getConfig().createRtcSignaling,
      });

      if (attempt !== privateRoomAttempt) {
        room.close();
        clearPendingPrivateMessages();
        logChatDebug('private:join-stale', { privateRoomId }, store);
        return;
      }

      privateRoom = room;
      bindPrivateRoomMessages(room);

      const unsubscribe = room.on('dataChannelOpen', () => {
        unsubscribe();
        if (attempt !== privateRoomAttempt || privateRoom !== room) {
          room.close();
          logChatDebug(
            'private:data-channel-open-stale',
            { privateRoomId },
            store,
          );
          return;
        }
        clearPendingPrivateMessages();
        setIsPendingPrivateResponse(false);
        setTransportMode('private');
        addSystemMessage('Private mode enabled');
        logChatDebug('private:data-channel-open', { privateRoomId }, store);
      });
    } catch (error) {
      clearPendingPrivateMessages();
      setIsPendingPrivateResponse(false);
      logChatDebug('private:join-failed', { error }, store);
    }
  }

  function closePrivateRoom() {
    privateRoomAttempt += 1;
    if (!privateRoom) return;
    privateRoomMsgCleanup?.();
    privateRoomMsgCleanup = null;
    privateRoom.close();
    privateRoom = null;
  }

  onCleanup(closePrivateRoom);

  createEffect(() => {
    const cleanupMessage =
      getConfig().callChannel?.onMessage(handleCallMessage);
    if (cleanupMessage) onCleanup(cleanupMessage);
  });

  createEffect(() => {
    const cleanupJoined = getConfig().callChannel?.onMemberJoined?.(
      (detail) => {
        addSystemMessage(`${detail.memberId} joined the call`);
      },
    );
    if (cleanupJoined) onCleanup(cleanupJoined);
  });

  createEffect(() => {
    const cleanupLeft = getConfig().callChannel?.onMemberLeft?.((detail) => {
      addSystemMessage(`${detail.memberId} left the call`);
    });
    if (cleanupLeft) onCleanup(cleanupLeft);
  });

  createEffect(() => {
    const current = getConfig();
    let cleanup: (() => void) | undefined;
    let disposed = false;

    const subscribeResult = current.messageTransport.subscribe(
      current.roomId,
      current.peerId,
      (msg) => {
        receiveMessage({ ...msg, source: 'persisted' });
      },
    );

    if (typeof subscribeResult === 'function') {
      cleanup = subscribeResult;
    } else {
      void subscribeResult.then((resolved) => {
        if (disposed) {
          resolved();
        } else {
          cleanup = resolved;
        }
      });
    }

    onCleanup(() => {
      disposed = true;
      cleanup?.();
    });
  });

  createEffect(() => {
    const current = getConfig();
    const privateChat = getPrivateChat();
    if (!privateChat) return;

    let cleanup: (() => void) | undefined;
    let disposed = false;
    const subscribeResult = privateChat.signaling.subscribe(
      current.roomId,
      current.peerId,
      {
        onRequest: (fromPeerId, privateRoomId) => {
          addSystemMessage(`${fromPeerId} started private mode`);
          void joinPrivateRoom(privateRoomId);
        },
        onCancel: () => {
          clearPendingPrivateMessages();
        },
        onResponse: (accepted) => {
          clearPendingPrivateMessages();
          setIsPendingPrivateResponse(false);
          if (!accepted) {
            closePrivateRoom();
            setTransportMode('persisted');
            addSystemMessage('Private mode request declined');
          }
        },
      },
    );

    if (typeof subscribeResult === 'function') {
      cleanup = subscribeResult;
    } else {
      void subscribeResult.then((resolved) => {
        if (disposed) {
          resolved();
        } else {
          cleanup = resolved;
        }
      });
    }

    onCleanup(() => {
      disposed = true;
      cleanup?.();
    });
  });

  async function send() {
    const current = getConfig();
    const text = chatState.draft.trim();
    if (!current.roomId || !current.peerId || !text) {
      logChatDebug(
        'send:skipped',
        {
          hasRoomId: Boolean(current.roomId),
          hasPeerId: Boolean(current.peerId),
          hasText: Boolean(text),
        },
        store,
      );
      return;
    }

    const tempId = crypto.randomUUID();
    const source = chatState.transportMode;
    logChatDebug(
      'send:start',
      {
        tempId,
        source,
        textLength: text.length,
      },
      store,
    );

    addOptimisticMessage({
      id: tempId,
      text,
      senderId: current.peerId,
      createdAt: Date.now(),
      status: 'sending',
      source,
    });
    clearDraft();
    setSending(true);

    try {
      if (chatState.transportMode === 'private') {
        const envelope: P2PChatEnvelope = {
          type: 'chat',
          id: tempId,
          text,
          senderId: current.peerId,
          createdAt: Date.now(),
        };

        if (privateRoom) {
          logChatDebug('send:route', { tempId, route: 'private-room' }, store);
          privateRoom.broadcast(JSON.stringify(envelope));
        } else if (
          current.callChannel &&
          current.callChannel.getPeerCount() > 0
        ) {
          logChatDebug('send:route', { tempId, route: 'call-channel' }, store);
          current.callChannel.broadcast(JSON.stringify(envelope));
        } else {
          logChatDebug(
            'send:route-missing',
            { tempId, source: 'private' },
            store,
          );
          markMessageFailed(tempId);
          return;
        }

        markMessageSent(tempId, tempId);
      } else {
        logChatDebug(
          'send:route',
          { tempId, route: 'message-transport' },
          store,
        );
        const saved = await current.messageTransport.send(
          current.roomId,
          current.peerId,
          text,
        );
        markMessageSent(tempId, saved.id);
      }
      logChatDebug('send:success', { tempId }, store);
    } catch (error) {
      markMessageFailed(tempId);
      logChatDebug('send:failed', { tempId, error }, store);
    } finally {
      setSending(false);
    }
  }

  async function requestPrivate() {
    const current = getConfig();
    const privateChat = getPrivateChat();
    if (!current.roomId || !current.peerId || !privateChat) return;

    if (chatState.isPendingPrivateResponse) {
      setIsPendingPrivateResponse(false);
      await privateChat.signaling.cancel(current.roomId);
      clearPendingPrivateMessages();
      closePrivateRoom();
      setTransportMode('persisted');
      return;
    }

    if (current.callChannel && current.callChannel.getPeerCount() > 0) {
      setTransportMode('private');
      addSystemMessage('Private mode enabled');
    } else {
      const privateRoomId = crypto.randomUUID();
      setIsPendingPrivateResponse(true);
      lastWaitingMsgId = addSystemMessage('Waiting for peer...');
      await privateChat.signaling.send(
        current.roomId,
        current.peerId,
        privateRoomId,
      );
      void joinPrivateRoom(privateRoomId);
    }
  }

  function exitPrivate() {
    setTransportMode('persisted');
    setIsPendingPrivateResponse(false);
    clearPendingPrivateMessages();
    closePrivateRoom();
    addSystemMessage('Private mode ended');
  }

  return {
    send,
    requestPrivate,
    exitPrivate,
    handleCallMessage,
  };
}
