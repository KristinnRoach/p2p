---
'@kidlib/p2p': patch
---

Add startup-safe `onRemoteStream`, `onRemoteTrack`, and `onDataChannel`
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
