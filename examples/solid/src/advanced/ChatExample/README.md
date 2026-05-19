# ChatExample

Drop-in path for an existing SolidJS app:

1. Copy the core files: `chat.types.ts`, `chat.transport.ts`, `chat.signaling.ts`, `chat.state.ts`, `chat.actions.ts`, `chat.service.ts`, `use-chat-transport.ts`, and `chat.components.tsx` if you want the provided UI.
2. Implement `MessageTransport` for your message store.
3. Optionally provide `privateChat` when you want private P2P messages.
4. If your app already has calls, pass a `CallChannelAdapter`; do not copy `use-call-manager.ts`.

`ChatRoom` requires app storage explicitly. Private P2P and call wiring are optional. The localStorage adapters in `demo.adapters.ts` are only for the demo app.

Minimal integration:

```tsx
import { ChatRoom } from './ChatExample';

<ChatRoom
  roomId={room.id}
  peerId={user.id}
  messageTransport={appMessages}
  debugMode={import.meta.env.DEV}
/>;
```

Add `privateChat` and/or `callChannel` only when those transports exist in the host app.

Pass `debugMode={true}` to emit structured `[ChatExample]` console.debug events for send routing and state changes. Pass a callback instead when you want to capture the same events in your own logger.

`createChatState` and `createChatActions` are exported for lower-level integrations that use `useChatTransport` directly. `ChatRoom` already creates instance-scoped state internally.

`demo.adapters.ts` and `use-call-manager.ts` are only for the runnable local demo. Keep them for localStorage testing; replace them in a real app.
