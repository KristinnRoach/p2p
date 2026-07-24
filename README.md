# @kidlib/p2p

Signaling-agnostic WebRTC helpers for group and 1:1 peer connections. No backend included — you provide the signaling transport.

The default configuration is STUN-only. That discovers direct paths but cannot
relay traffic; production calls on symmetric NATs, restrictive mobile or
corporate networks, and some CGNATs need a TURN service.

## Install

```bash
pnpm add @kidlib/p2p
```

## Group calls — P2PRoom

`joinP2PRoom` connects a local member into a mesh room. Each remote member gets its own 1:1 connection managed automatically.

```js
import { joinP2PRoom } from '@kidlib/p2p';

const room = await joinP2PRoom({
  peerId: crypto.randomUUID(),
  presenceData: { displayName: 'Ada', callState: 'joined' },
  roomId,
  createSignaling: ({ roomId }) => createRoomSignalingForApp(roomId),
  getLocalStream: () =>
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
  onLocalStream: ({ stream }) => renderLocalPreview(stream),
});

const renderRemoteStreams = () => renderRemoteTiles(room.remoteMemberStreams);

room.on('memberStream', renderRemoteStreams);
room.on('memberLeft', renderRemoteStreams);
room.on('membersChanged', ({ memberCount, memberCapacity, memberPresence }) => {
  renderCapacity(memberCount, memberCapacity);
  renderRoster(memberPresence);
});

await room.setPresenceData({ displayName: 'Ada', muted: true });

await room.dispose();
```

For short-lived TURN credentials, provide one callback that calls your
authenticated backend. A room fetches once before creating peer connections,
shares the result across its pairs, and refreshes it before expiry:

```js
const room = await joinP2PRoom({
  peerId,
  signaling,
  iceServersProvider: async ({ signal }) => {
    const response = await fetch('/api/turn-credentials', { signal });
    if (!response.ok) throw new Error('TURN credentials unavailable');
    return response.json(); // { iceServers: [...], expiresAt?: epochMs }
  },
});
```

Provider account secrets belong only on that backend, never in browser code.
Static TURN remains supported through `rtcConfig.iceServers`.

Factory-created media is owned by the room: `leave()` and `dispose()` stop the
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
  memberCapacity: 2,
});

room.on('full', ({ members, memberCapacity }) => {
  showRoomFull(members, memberCapacity);
});

// `alone` fires when the last remote member leaves. For 1:1 call flows,
// pass `autoDisposeWhenAlone: true` to dispose the room automatically instead.
room.on('alone', () => endCall());

// `memberStreamRemoved` fires whenever a remote stream is dropped (peer left,
// connection closed, failed, or aborted). `memberLeft` is unchanged.
room.on('memberStreamRemoved', ({ memberId }) => removeRemoteTile(memberId));

await room.join();  // enter presence and connect
await room.leave();   // leave presence, close sessions, keep watching
await room.dispose(); // leave presence and permanently tear down the room
```

Use `leave()` when the app wants to keep observing the same room after the
local member exits. Use `dispose()` when the user is done with the room; it
awaits explicit departure before tearing down subscriptions, peer connections,
owned media, and signaling.

### Lifecycle naming

Package-owned objects use `dispose()` for permanent, non-reusable teardown:
`P2PRoom`, `P2PSession`, and `Peer`. Only rooms also expose `leave()`, which
exits presence while keeping the room reusable. Low-level signaling transports
and native WebRTC objects retain their conventional `close()` methods.

### Reserved local media slots

Use `localTrackSlots` when a call must reserve a sender before initial SDP
negotiation. Slots are keyed by caller-defined ID, so multiple slots may have
the same media kind. A null slot needs no placeholder track or device
permission and can later receive a same-kind track with `setLocalTrack()`:

```js
const localStream = await navigator.mediaDevices.getUserMedia({
  audio: true,
  video: isVideoCall,
});

const room = await joinP2PRoom({
  peerId,
  signaling,
  localStream,
  localTrackSlots: [
    {
      id: 'microphone',
      kind: 'audio',
      track: localStream.getAudioTracks()[0],
    },
    {
      id: 'primary-video',
      kind: 'video',
      track: localStream.getVideoTracks()[0] ?? null,
    },
  ],
});

// Camera on, camera switch, screen capture, camera off, and restore all use
// the same reserved sender and do not require SDP renegotiation.
await room.setLocalTrack('primary-video', cameraTrack);
await room.setLocalTrack('primary-video', backCameraTrack);
await room.setLocalTrack('primary-video', screenTrack);
await room.setLocalTrack('primary-video', null);
```

Slot tracks are caller-owned: replacement never stops the old or new track.
The room adds/removes the current slot tracks from `room.localStream` and emits
`localStream` so previews and Solid adapters can react. With `getLocalStream`,
the room retains its existing whole-stream cleanup behavior, except that later
slot replacement tracks remain caller-owned.
If a slot still references a factory-owned track when the room releases that
stream, the slot resets to null rather than retaining an ended track.

Unknown slot IDs and media-kind mismatches reject before changing state. For a
room-wide replacement, the room commits the requested track as its desired
state and attempts every active pair. If some `replaceTrack()` calls fail,
`setLocalTrack()` rejects with `LocalTrackReplacementError`; its `slotId` and
`failures` array identify each failed `memberId` and underlying error.
Successful pairs and members joining later use the new track, while failed
pairs retain their previous sender track. Calling `setLocalTrack()` again
retries all active pairs. Overlapping calls for the same slot are not
serialized; await each `setLocalTrack()` before issuing the next.

When `localTrackSlots` is omitted, publication continues to use the existing
`localStream`/`getLocalStream` and `audioOnly` behavior unchanged. Slot mode is
opt-in and its slots define which local tracks are published: tracks in
`localStream` or a factory stream that no slot references appear in
`room.localStream` but are never sent to remote members.

Because the video m-line is negotiated up front, a remote browser may expose a
muted video receiver track before the camera is installed. Consumers should
treat track mute/unmute and media availability as transport state rather than
as a semantic camera label; this package intentionally adds no remote slot
labeling or signaling protocol.

A `peerId` is a singleton identity: if a peer reloads or reconnects under the
same id, the room tears down the old session and builds a fresh one. Your
signaling adapter owns expiring peers that disappear without a clean `leave()`
(e.g. a crash) — see [docs/signaling.md](docs/signaling.md#reconnect-and-stale-presence).

Solid apps can use the `@kidlib/p2p/solid` adapter. See
[docs/solidjs.md](docs/solidjs.md).

Browser-native apps can use the `@kidlib/p2p/components` web components. See
[docs/web-components.md](docs/web-components.md).

## 1:1 calls — P2PSession

For direct connections between exactly two peers.

```js
import { startP2PSession, joinP2PSession } from '@kidlib/p2p';

// Initiator — sends the offer
const session = await startP2PSession({ signaling, localStream });

// Joiner — answers the offer
const session = await joinP2PSession({ signaling, localStream });

session.on('remoteStream', ({ stream }) => renderStream(stream));
session.dispose();
```

`signaling` must implement `RtcSignalingSource` — see [docs/signaling.md](docs/signaling.md).

## Lower-level exports

| Export | Description | Docs |
|--------|-------------|------|
| `createPairSignaling` | Normalize a 1:1 signaling source | [docs/signaling.md](docs/signaling.md) |
| `createRelayPeerSignaling` | Adapt a peer-addressed relay stream into 1:1 signaling | [docs/signaling.md](docs/signaling.md) |
| `createRoomSignaling` | Normalize a room signaling source | [docs/signaling.md](docs/signaling.md) |
| `validateRoomSignaling` | Validate a room signaling source | [docs/signaling.md](docs/signaling.md) |
| `Peer` | Direct `RTCPeerConnection` control | [docs/peer.md](docs/peer.md) |
| `attachRemoteStream` | Assemble remote tracks into a `MediaStream` | [docs/peer.md](docs/peer.md) |
| `setLogger` | Wire a custom logger | [docs/peer.md](docs/peer.md) |

## Development

```bash
pnpm install
pnpm test
```

Tests run in Vitest browser mode against real browser WebRTC APIs via Playwright Chromium.
