# Integration Notes

Implement app storage, then pass it into `ChatRoom` or `useChatTransport`. Add private signaling only if the app needs private P2P messages. There are no production defaults; demo localStorage adapters must be imported explicitly only for local testing.

```ts
import type {
  ChatExampleConfig,
  MessageTransport,
} from './ChatExample';

const config: ChatExampleConfig = {
  roomId,
  peerId,
  messageTransport: yourMessageTransport satisfies MessageTransport,
  debugMode: import.meta.env.DEV,
};
```

Optional private P2P support belongs under `privateChat: { signaling, createRoom }`. Optional call data-channel reuse belongs under `callChannel`.

`debugMode` can also be a callback:

```ts
debugMode: (event) => appLogger.debug(event.type, event),
```

When using `useChatTransport` without `ChatRoom`, create per-instance state:

```ts
const store = createChatState();
const actions = createChatActions(store);
const transport = useChatTransport(config, store, actions);
```
