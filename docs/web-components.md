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
  <p2p-text-chat></p2p-text-chat>
</p2p-room>
```

## Configuration

`defineP2PComponents(options)` registers:

- `p2p-room`
- `p2p-room-controls`
- `p2p-room-status`
- `p2p-video-grid`
- `p2p-text-chat`

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

The default elements are intentionally modest. Use the `p2p-room` snapshot and
events if you want to replace the controls, status, video grid, or chat UI with
app-specific components.
