import {
  createEffect,
  createMemo,
  createRoot,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { Match, Switch } from 'solid-js';
import { useP2PRoom } from '@kidlib/p2p/solid';
import type { SolidP2PRoom } from '@kidlib/p2p/solid';
import type { ChatExampleConfig } from './chat.types';
import { createChatState, type ChatStateStore } from './chat.state';
import { createChatActions, type ChatActions } from './chat.actions';
import { loadMessages } from './chat.service';
import { useChatTransport } from './use-chat-transport';
import { useCallManager } from './use-call-manager';
import type { InvitationSignaling } from './chat.signaling';

import './chat.css';

export type ChatRoomProps = ChatExampleConfig & {
  demoCallSignaling?: InvitationSignaling;
};

export function ChatRoom(props: ChatRoomProps) {
  const p2p = useP2PRoom();
  const store = createChatState();
  const actions = createChatActions(store);
  let loadVersion = 0;

  onCleanup(() => {
    loadVersion += 1;
    p2p.close();
  });

  createEffect(() => {
    const version = ++loadVersion;
    void loadMessages(props, store, actions, () => version === loadVersion);
  });

  return (
    <div class='wrapper'>
      <ChatPanel
        config={props}
        p2p={p2p}
        store={store}
        actions={actions}
        demoCallSignaling={props.demoCallSignaling}
      />
    </div>
  );
}

function createDemoCallChannel(p2p: SolidP2PRoom) {
  function onRoomEvent<T>(
    type: string,
    callback: (detail: T) => void,
  ): () => void {
    return createRoot((dispose) => {
      createEffect(() => {
        const room = p2p.room();
        if (!room) return;
        const unsubscribe = room.on(type, callback);
        onCleanup(unsubscribe);
      });
      return dispose;
    });
  }

  return {
    getPeerCount: () => p2p.dataChannels().size,
    broadcast: (data: string) => {
      p2p.broadcast(data);
    },
    onMessage: (callback: (data: string) => void) => {
      return onRoomEvent<{ data: unknown }>('dataChannelMessage', ({ data }) =>
        callback(data as string),
      );
    },
    onMemberJoined: (callback: (detail: { memberId: string }) => void) => {
      return onRoomEvent('memberJoined', callback);
    },
    onMemberLeft: (
      callback: (detail: {
        memberId: string;
        stream: MediaStream | null;
      }) => void,
    ) => {
      return onRoomEvent('memberLeft', callback);
    },
  };
}

function ChatPanel(props: {
  config: ChatExampleConfig;
  p2p: SolidP2PRoom;
  store: ChatStateStore;
  actions: ChatActions;
  demoCallSignaling?: InvitationSignaling;
}) {
  const chatState = props.store.state;
  const chatConfig = createMemo<ChatExampleConfig>(() => ({
    ...props.config,
    callChannel:
      props.config.callChannel ??
      (props.demoCallSignaling ? createDemoCallChannel(props.p2p) : undefined),
  }));
  const { send, requestPrivate, exitPrivate } = useChatTransport(
    chatConfig,
    props.store,
    props.actions,
  );
  const call = useCallManager(props.p2p, {
    enabled: Boolean(props.demoCallSignaling),
    callSignaling: props.demoCallSignaling,
    store: props.store,
    actions: props.actions,
  });

  const isPrivate = () => chatState.transportMode === 'private';
  const hasPrivateChat = () => {
    const config = chatConfig();
    return Boolean(config.privateChat);
  };
  const hasPendingPrivateInvite = () => Boolean(call.incomingCallInvite());
  const inCall = () => props.p2p.state() === 'joined';
  const isConnecting = () =>
    props.p2p.state() === 'creating' || props.p2p.state() === 'joining';

  async function clearMessages() {
    if (!chatState.roomId) return;
    await props.config.messageTransport.clear(chatState.roomId);
    props.store.setState('messages', []);
  }

  const onSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    void send();
  };

  return (
    <section class={`chat-panel${isPrivate() ? ' is-private' : ''}`}>
      <Show when={props.p2p.remoteMemberStreams().length > 0}>
        <video
          class='remote-stream-preview'
          ref={(el) => {
            createEffect(() => {
              el.srcObject = props.p2p.remoteMemberStreams()[0]?.stream ?? null;
            });
          }}
          autoplay
          playsinline
        />
      </Show>

      <Show when={props.demoCallSignaling && call.incomingCallInvite()}>
        <div class='call-notification'>
          <span>
            <strong>{call.incomingCallInvite()!.from}</strong> is calling
          </span>
          <button
            type='button'
            class='button'
            onClick={() => void call.acceptCall()}
          >
            Accept
          </button>
          <button type='button' onClick={call.declineCall}>
            Decline
          </button>
        </div>
      </Show>

      <header class='chat-header'>
        <div>
          <p class='chat-meta'>
            Room: <strong>{chatState.roomId}</strong> · You:{' '}
            <strong>{chatState.peerId}</strong>
          </p>
        </div>

        <div class='controls'>
          <Show when={props.demoCallSignaling}>
            <div class='call-controls'>
              <Show
                when={inCall()}
                fallback={
                  <Show
                    when={call.isPendingCallResponse()}
                    fallback={
                      <button
                        type='button'
                        class='button start-call'
                        disabled={isConnecting()}
                        onClick={call.startCall}
                      >
                        {isConnecting() ? 'Connecting...' : 'Call'}
                      </button>
                    }
                  >
                    <span class='chat-pending'>Waiting for answer...</span>
                    <button type='button' onClick={call.cancelCall}>
                      Cancel
                    </button>
                  </Show>
                }
              >
                <button
                  type='button'
                  class='button hangup'
                  onClick={() => void call.endCall()}
                >
                  Hang Up
                </button>
              </Show>
            </div>
          </Show>

          <div class='chat-privacy-controls'>
            <button
              type='button'
              class='button clear-messages'
              onClick={() => void clearMessages()}
            >
              Clear
            </button>
            <Show when={hasPrivateChat()}>
              <button
                type='button'
                class={`button privacy${chatState.isPendingPrivateResponse ? ' pending' : isPrivate() ? ' active' : ''}`}
                disabled={hasPendingPrivateInvite()}
                onClick={() =>
                  void (isPrivate() ? exitPrivate() : requestPrivate())
                }
                title={
                  hasPendingPrivateInvite()
                    ? 'Respond to the pending private request first'
                    : chatState.isPendingPrivateResponse
                      ? 'Cancel private mode request'
                      : isPrivate()
                        ? 'Exit private mode - messages will be stored again'
                        : 'Go private - messages sent directly, not stored'
                }
              >
                {chatState.isPendingPrivateResponse
                  ? 'Cancel Request'
                  : isPrivate()
                    ? 'Private (on)'
                    : 'Private (off)'}
              </button>
            </Show>
          </div>
        </div>
      </header>

      <div class='chat-messages'>
        <For each={chatState.messages}>
          {(message) => (
            <Switch>
              <Match when={message.source === 'system'}>
                <div class='chat-system-message'>
                  {message.text}
                  <Show when={message.actions && message.actions.length > 0}>
                    <span class='chat-system-actions'>
                      <For each={message.actions}>
                        {(action) => (
                          <button type='button' onClick={action.onClick}>
                            {action.label}
                          </button>
                        )}
                      </For>
                    </span>
                  </Show>
                </div>
              </Match>
              <Match when={message.source !== 'system'}>
                <article
                  class={`chat-message ${message.source}`}
                  data-own={message.senderId === chatState.peerId}
                >
                  <div class='chat-message-sender'>
                    <strong>{message.senderId}</strong>
                    <Show when={message.source === 'private'}>
                      <span class='chat-private-badge'>private</span>
                    </Show>
                  </div>

                  <div class='chat-message-bubble'>
                    <p class='chat-message-text'>{message.text}</p>
                    <Show when={message.status !== 'sent'}>
                      <small class={`chat-message-status ${message.status}`}>
                        {message.status}
                      </small>
                    </Show>

                    <span class='chat-message-timestamp'>
                      {new Date(message.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      })}
                    </span>
                  </div>
                </article>
              </Match>
            </Switch>
          )}
        </For>
      </div>

      <form class='chat-form' onSubmit={onSubmit}>
        <input
          type='text'
          class='chat-input'
          placeholder={isPrivate() ? 'Private message...' : 'Write a message'}
          value={chatState.draft}
          onInput={(e) => props.actions.setDraft(e.currentTarget.value)}
        />
        <button
          type='submit'
          class='button'
          disabled={
            !chatState.roomId || !chatState.draft.trim() || chatState.sending
          }
        >
          {chatState.sending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </section>
  );
}
