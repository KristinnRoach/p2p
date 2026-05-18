# @kidlib/p2p Web Components Example

Small browser-native custom elements for a `P2PRoom` video room with text chat.

```html
<script type="module" src="./p2p-room-components.js"></script>

<p2p-room room-id="demo-room" member-capacity="6">
  <p2p-room-controls></p2p-room-controls>
  <p2p-room-status></p2p-room-status>
  <p2p-video-grid></p2p-video-grid>
  <p2p-text-chat></p2p-text-chat>
</p2p-room>
```

Run it from this directory:

```sh
pnpm dev
```

Then open the local URL in a few browser tabs and join the same room.
