---
'@kidlib/p2p': patch
---

Add startup-safe `onRemoteStream`, `onRemoteTrack`, and `onDataChannel`
callbacks to the session helpers so consumers can subscribe before async
session startup begins.

Make remote media delivery more robust by emitting receiver tracks from
`RTCPeerConnection.getReceivers()` when a browser exposes live receiver tracks
without dispatching a `track` event.

Add a minimal draft `createRoomSignaling` plus `joinP2PRoom`/`P2PRoom` mesh
abstraction that manages one `P2PSession` per remote peer through an injected
room signaling adapter, with peer-scoped media and data channel callbacks.
