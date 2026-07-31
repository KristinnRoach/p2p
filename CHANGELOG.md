# @kidlib/p2p

## 0.5.1

### Patch Changes

- 15aa884: Forward `connectedTimeoutMs` from `P2PRoom` to its peer sessions and log concise WebRTC state when initial connection establishment fails.

## 0.5.0

### Minor Changes

- 6a995a9: Add shared, automatically refreshed ephemeral TURN credentials for peers, sessions, and rooms.
- ced2977: Add opt-in, bounded ICE restart recovery across peers, sessions, and rooms.

  Note: the `connected` event now fires at most once per `Peer`, even when
  `iceRecovery` is disabled. Previously it fired on every transition to
  `connected`. Later reconnections continue to be reported via `statechange`.

## 0.4.0

### Minor Changes

- 1cd6407: Add explicit `left` versus `dropped` reasons to room departure events.
- b677367: Replace lifecycle `close()` methods on `P2PRoom`, `P2PSession`, `Peer`, and the
  Solid room adapter with `dispose()`. Package-owned objects now consistently use
  `dispose()` for permanent, non-reusable teardown; low-level signaling and native
  WebRTC transports retain their conventional `close()` methods.

  Room disposal is asynchronous because it first awaits an explicit signaling
  departure so network transports report intentional exits as `left` instead of
  racing teardown and reporting `dropped`. Peer and session disposal remain
  synchronous because they have no presence departure to await.

  Use `await room.leave()` to exit presence while keeping the room reusable. Use
  `await room.dispose()` for graceful departure followed by permanent teardown.
  The related `autoCloseWhenAlone` option is now `autoDisposeWhenAlone`.

### Patch Changes

- 8b69951: Serialize `useP2PRoom` lifecycle transitions on a single chain. `watch()`,
  `dispose()`, and teardown of superseded rooms now run one at a time, so a
  second `watch()` can no longer start creating a room while an earlier creation
  is still in flight — which previously left two rooms using the same peer
  identity and signaling at once. A superseded room is never published through
  the `room` signal, and a rejected creation or disposal no longer blocks later
  transitions. `leave()` no longer writes the left room's membership and streams
  back over the signals when a `watch()` supersedes it mid-call.

## 0.3.0

### Minor Changes

- 20ad498: Add opt-in reserved local media publication slots that can replace or clear
  tracks across active room members without SDP renegotiation.

## 0.2.3

### Patch Changes

- 2c814c6: Make Solid room joins reject when joining fails.

## 0.2.2

### Patch Changes

- 55e976e: Update the Solid room adapter's `remoteMemberStreams` signal when core emits `memberStreamRemoved`, so Solid consumers clear failed or aborted remote streams even when membership does not change.

## 0.2.1

### Patch Changes

- 7374feb: Add remote stream removal and alone/auto-exit lifecycle to `P2PRoom`:

  - New `memberStreamRemoved` event (with deprecated `peerStreamRemoved` alias) fires whenever a remote stream is dropped — peer left, or the connection closed, failed, or was aborted. `memberLeft` behavior is unchanged.
  - New `alone` event fires when the last remote member leaves (the local peer becomes the only member). It does not fire when joining an empty room.
  - New `autoCloseWhenAlone` option closes the room automatically when `alone` would fire — convenient for 1:1 call flows.

  No breaking changes — all additive. Existing events and `memberLeft` are unchanged, and `autoCloseWhenAlone` defaults to `false`. Note that on a peer leaving you now receive both `memberStreamRemoved` (if that peer had a stream) and the existing `memberLeft`; handle whichever fits, not both, to avoid removing a tile twice.

## 0.2.0

### Minor Changes

- 9eb893e: Add Solid media playback helpers to `@kidlib/p2p/solid`:

  - `attachMediaStream(video, stream, options)`: framework-agnostic controller that sets `srcObject`, attempts `play()`, and exposes `resumePlayback()` for retrying after autoplay is blocked.
  - `createMediaPlayback(options)`: Solid wrapper exposing reactive `playbackBlocked` / `playbackError` signals plus `attach`/`detach`/`resumePlayback`, with auto-cleanup on dispose.

  Wire `resumePlayback()` to a user gesture (e.g. a "Continue call" button) to recover when the browser blocks autoplay. UI rendering stays in the consuming app.

### Patch Changes

- ff39bd9: Presence snapshots with duplicate member IDs are now de-duped at the library level.

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
