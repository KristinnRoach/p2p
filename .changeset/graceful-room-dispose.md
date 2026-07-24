---
"@kidlib/p2p": major
---

Replace lifecycle `close()` methods on `P2PRoom`, `P2PSession`, `Peer`, and the
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
