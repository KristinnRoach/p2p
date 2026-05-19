# Web Components

`@kidlib/p2p/components` provides browser-native custom elements for a minimal
mesh room UI. It stays signaling-agnostic: your app still supplies the room
signaling adapter.

```js
import { defineP2PComponents } from '@kidlib/p2p/components';

defineP2PComponents({
  createSignaling: ({ roomId }) => createRoomSignalingForApp(roomId),
});
```

```html
<p2p-room room-id="demo-room" member-capacity="6">
  <p2p-room-controls></p2p-room-controls>
  <p2p-room-status></p2p-room-status>
  <p2p-video-grid></p2p-video-grid>
  <p2p-chat></p2p-chat>
</p2p-room>
```

## Configuration

`defineP2PComponents(options)` registers:

- `p2p-room`
- `p2p-room-controls`
- `p2p-room-status`
- `p2p-video-grid`
- `p2p-chat`

Supported options:

- `createSignaling`: required before joining. Receives `{ roomId }` and returns
  a `P2PRoomSignaling` adapter.
- `getLocalStream`: optional. Defaults to
  `navigator.mediaDevices.getUserMedia({ video: true, audio: true })`.
- `roomOptions`: optional `P2PRoomOptions` overrides for all component rooms.

You can also configure a single room element:

```js
const room = document.querySelector('p2p-room');

room.createSignaling = ({ roomId }) => createRoomSignalingForApp(roomId);
room.getLocalStream = () =>
  navigator.mediaDevices.getUserMedia({ video: true, audio: false });
room.roomOptions = {
  rtcConfig: {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  },
};
```

## Attributes

`p2p-room`:

- `room-id` (string)
- `member-capacity` (number)
- `peer-id` (string, optional) — supply a stable identity. When omitted, the
  element generates a UUID once on construction.

`p2p-chat`:

- `max-messages` (number, default 50) — in-memory cap for rendered messages.

## Styling

All elements expose CSS custom properties on `:host`:

| Property          | Default   |
| ----------------- | --------- |
| `--p2p-accent`    | `#1455d9` |
| `--p2p-accent-fg` | `#fff`    |
| `--p2p-border`    | `#c9ced6` |
| `--p2p-radius`    | `6px`     |
| `--p2p-bg`        | `#fff`    |
| `--p2p-fg`        | `#354052` |
| `--p2p-muted-fg`  | `#667085` |
| `--p2p-error`     | `#b42318` |

Shadow parts are exposed for deeper overrides:

- `p2p-room-controls`: `form`, `room-id-input`, `join-button`, `leave-button`
- `p2p-room-status`: `status`, `members`, `error`
- `p2p-video-grid`: `grid`, `empty`, `tile`, `video`, `caption`
- `p2p-chat`: `messages`, `message`, `form`, `input`, `send-button`

```css
p2p-chat::part(send-button) {
  background: rebeccapurple;
}
```

## Events And Methods

`p2p-room` dispatches:

- `p2p-room-change` with the current room snapshot.
- `p2p-chat-message` when text chat messages are sent or received.

Useful methods:

- `room.join()`
- `room.leave()`
- `room.sendChat(text)`
- `room.subscribe((snapshot) => {})`

## Extending Chat

`p2p-chat` is a minimal text chat widget. It is meant to be useful out of the
box, not to be the main extension point for richer messaging.

For file transfer, reactions, message persistence, or app-specific message
types, build a custom element inside `p2p-room` and use the room primitive:

```js
const roomElement = document.querySelector('p2p-room');

roomElement.subscribe(({ room }) => {
  if (!room) return;
  room.broadcast(JSON.stringify({ type: 'app:file-offer', name, size }));
});
```

The underlying `P2PRoom` is available on the snapshot as `snapshot.room`, so a
custom component can use `room.send()`, `room.broadcast()`, or
`room.dataChannels` directly. That keeps `p2p-chat` small while leaving room for
larger features such as file-transfer protocols.

The default elements are intentionally modest. Use the `p2p-room` snapshot and
events if you want to replace the controls, status, video grid, or chat UI with
app-specific components.

## SolidJS

Import from `@kidlib/p2p/components/solid` to use the SolidJS wrapper components. They automatically handle element registration and complex prop binding for you.

```tsx
import {
  P2PRoom,
  P2PRoomControls,
  P2PRoomStatus,
  P2PVideoGrid,
  P2PChat,
} from '@kidlib/p2p/components/solid';

// No need to call defineP2PComponents manually, the wrappers handle it

function App() {
  return (
    <P2PRoom
      roomId="demo-room"
      memberCapacity={6}
      createSignaling={({ roomId }) => createRoomSignalingForApp(roomId)}
      roomOptions={{ rtcConfig: { iceServers: [...] } }}
      onRoomChange={(event) => setSnapshot(event.detail)}
    >
      <P2PRoomControls />
      <P2PRoomStatus />
      <P2PVideoGrid />
      <P2PChat onChatMessage={(event) => appendMessage(event.detail)} />
    </P2PRoom>
  );
}
```

The underlying web components are still fully accessible via standard `ref`s if you need imperative access to their methods (like `room.join()`).
