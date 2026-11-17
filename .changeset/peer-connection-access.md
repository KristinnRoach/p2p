---
'@kidlib/p2p': patch
---

Expose the underlying `RTCPeerConnection` for advanced sender tuning and stats: `P2PSession.peerConnection`, `P2PRoom.getPeerConnection(memberId)`, `P2PRoom.peerConnections()`, and a room `peerConnection` event (`onPeerConnection` option) fired when a member's connection is established. Slot senders are stable across `setLocalTrack()`, so sender parameters survive track replacement.
