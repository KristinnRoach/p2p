# @kidlib/p2p

## 0.1.12

### Patch Changes

- acc454c: Add per-member presence data so apps can attach roster metadata (e.g. display name, mute state) to room members and update it mid-call, and add `createRelayPeerSignaling()` for adapting peer-addressed relay transports into pair signaling.

## 0.1.11

### Patch Changes

- 2a098f4: Enforce memberCapacity on backends that deliver presence asynchronously: join waits for the first onPeers snapshot before checking capacity, and the watcher-snapshot contract is now documented.

## 0.1.10

### Patch Changes

- 6dd3f7f: - Added experimental browser-native room UI components via `@kidlib/p2p/components`; this API is likely to change.
  - Added experimental Solid JSX wrappers and types via `@kidlib/p2p/components/solid`; this API is likely to change.
  - Stabilized `P2PRoom.remoteMemberStreams` identity and browser mesh presence ordering to reduce remote video reordering and flicker.

## 0.1.9

### Patch Changes

- be85e8f: Add room signaling cleanup hook

## 0.1.8

### Patch Changes

- 79ae894: Remove data-channel module and expand Solid adapter.

## 0.1.7

### Patch Changes

- 616c5d4: Add SolidJS adapter and expose validateRoomSignaling().

## 0.1.6

### Patch Changes

- ce4ad51: Refine the P2PRoom member API with membership/state accessors, member-scoped
  callbacks, typed room-full/local-stream errors, presence heartbeats/pagehide
  cleanup, and refreshed room docs/examples.

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
