# @kidlib/p2p/components Example

Small browser-native custom elements for a `P2PRoom` video room with text chat.
This example imports the source module directly so local development reflects
unpublished changes.

```html
<script type="module">
  import { defineP2PComponents } from '../../src/components/web-components.js';
  import { createBroadcastRoomSignaling } from '../shared/index.js';

  defineP2PComponents({
    createSignaling: ({ roomId }) => createBroadcastRoomSignaling(roomId),
  });
</script>

<p2p-room room-id="demo-room" member-capacity="6">
  <p2p-room-controls></p2p-room-controls>
  <p2p-room-status></p2p-room-status>
  <p2p-video-grid></p2p-video-grid>
  <p2p-chat></p2p-chat>
</p2p-room>
```

Run it from this directory:

```sh
pnpm dev
```

Then open the local URL in a few browser tabs and join the same room.

For package usage, see [../../docs/web-components.md](../../docs/web-components.md).
