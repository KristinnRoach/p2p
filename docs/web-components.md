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

Import from `@kidlib/p2p/components/solid` to register the elements and pull in
JSX type augmentation in one step:

```ts
import {
  defineP2PComponents,
  // P2PRoomElement etc. also re-exported
} from '@kidlib/p2p/components/solid';

defineP2PComponents({
  createSignaling: ({ roomId }) => createRoomSignalingForApp(roomId),
});
```

Tags (`p2p-room`, `p2p-chat`, ...) are typed on `JSX.IntrinsicElements`.
Object-shaped configuration must be passed as a property via Solid's `prop:`
namespace (attributes coerce to strings):

```tsx
<p2p-room
  room-id="demo-room"
  member-capacity={6}
  prop:createSignaling={({ roomId }) => createRoomSignalingForApp(roomId)}
  prop:roomOptions={{ rtcConfig: { iceServers: [...] } }}
  on:p2p-room-change={(event) => setSnapshot(event.detail)}
  on:p2p-chat-message={(event) => appendMessage(event.detail)}
>
  <p2p-room-controls />
  <p2p-video-grid />
  <p2p-chat />
</p2p-room>
```

`on:p2p-room-change` and `on:p2p-chat-message` are typed as
`CustomEvent<P2PRoomSnapshot>` and `CustomEvent<P2PChatMessage>` respectively.
