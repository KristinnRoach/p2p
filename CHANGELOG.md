# @kidlib/p2p

## 0.1.5

### Patch Changes

- a41a378: Add startup-safe `onRemoteStream`, `onRemoteTrack`, and `onDataChannel`
  callbacks to the session helpers so consumers can subscribe before async
  session startup begins.

  Make remote media delivery more robust by emitting receiver tracks from
  `RTCPeerConnection.getReceivers()` when a browser exposes live receiver tracks
  without dispatching a `track` event.

  Add `createRoomSignaling` plus `joinP2PRoom`/`P2PRoom` mesh APIs that manage
  one `P2PSession` pair per remote peer through an injected room signaling
  adapter, with peer-scoped media and data channel callbacks.

  Rename the normalized 1:1 signaling helper to `createPairSignaling` and the
  raw signaling contract to `RtcSignalingSource` for clearer pair-vs-room naming.

  Add TypeScript declarations for the root package and published subpath exports.

  Add `watchP2PRoom`, explicit `join()`/`leave()` room lifecycle controls,
  lazy `createSignaling`/`roomId` and `getLocalStream` factories, `maxPeers`
  room-full handling, and related room cleanup/retry fixes.

## 0.1.4

### Patch Changes

- 7fa7db2: Remove unnecessary utils (generic id generation)
- 625bd31: Expose high-level helpers: startP2PSession() and joinP2PSession()

## 0.1.3

### Patch Changes

- Harden helper cleanup behavior.

## 0.1.2

### Patch Changes

- 5c7e2c6: Add createSignalingChannel to validate signaling adapters, normalize cleanup, and guard callbacks after unsubscribe/close.

  Add attachRemoteStream to assemble remote media streams from Peer or RTCPeerConnection track events.

## 0.1.1

### Patch Changes

- 8fd051b: Initialize package
