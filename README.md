# @kidlib/p2p

Signaling-agnostic WebRTC helpers for group and 1:1 peer connections. No backend included — you provide the signaling transport.

## Install

```bash
pnpm add @kidlib/p2p
```

## Group calls — P2PRoom

`joinP2PRoom` connects a local peer into a mesh room. Each remote peer gets its own 1:1 connection managed automatically.

```js
import { joinP2PRoom } from '@kidlib/p2p';

const room = await joinP2PRoom({
  peerId: crypto.randomUUID(),
  roomId,
  createSignaling: ({ roomId }) => createRoomSignalingForApp(roomId),
  getLocalStream: () =>
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
  onLocalStream: ({ stream }) => renderLocalPreview(stream),
});

room.on('peerStream', ({ peerId, stream }) => renderStream(peerId, stream));
room.on('peerLeft',   ({ peerId })         => removeStream(peerId));

room.close();
```

Factory-created media is owned by the room: `leave()` and `close()` stop the
local tracks. You can still pass `signaling` and `localStream` directly when an
app needs to own setup, preview, device switching, or teardown itself.

Use `watchP2PRoom` to observe room presence before joining. This lets an app
detect incoming calls or capacity without announcing the local peer.

```js
import { watchP2PRoom } from '@kidlib/p2p';

const room = await watchP2PRoom({
  roomId,
  createSignaling: ({ roomId }) => createRoomSignalingForApp(roomId),
  getLocalStream: () =>
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
  peerId: crypto.randomUUID(),
  maxPeers: 2,
});

room.on('full', ({ peerIds, maxPeers }) => showRoomFull(peerIds, maxPeers));

await room.join();  // enter presence and connect
await room.leave(); // leave presence, close sessions, keep watching
room.close();       // permanent teardown
```

## 1:1 calls — P2PSession

For direct connections between exactly two peers.

```js
import { startP2PSession, joinP2PSession } from '@kidlib/p2p';

// Initiator — sends the offer
const session = await startP2PSession({ signaling, localStream });

// Joiner — answers the offer
const session = await joinP2PSession({ signaling, localStream });

session.on('remoteStream', ({ stream }) => renderStream(stream));
session.close();
```

`signaling` must implement `RtcSignalingSource` — see [docs/signaling.md](docs/signaling.md).

## Lower-level exports

| Export | Description | Docs |
|--------|-------------|------|
| `createPairSignaling` | Normalize a 1:1 signaling source | [docs/signaling.md](docs/signaling.md) |
| `createRoomSignaling` | Normalize a room signaling source | [docs/signaling.md](docs/signaling.md) |
| `Peer` | Direct `RTCPeerConnection` control | [docs/peer.md](docs/peer.md) |
| `createDataChannel` / `joinDataChannel` | Data-only peer connection | [docs/peer.md](docs/peer.md) |
| `attachRemoteStream` | Assemble remote tracks into a `MediaStream` | [docs/peer.md](docs/peer.md) |
| `setLogger` | Wire a custom logger | [docs/peer.md](docs/peer.md) |

## Development

```bash
pnpm install
pnpm test
```

Tests run in Vitest browser mode against real browser WebRTC APIs via Playwright Chromium.
