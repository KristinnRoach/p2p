---
"@kidlib/p2p": major
---

Replace `P2PRoom.close()` and the Solid adapter's `close()` with asynchronous
`dispose()`. `dispose()` permanently tears down the room, but first awaits an
explicit signaling departure so network transports report intentional exits as
`left` instead of racing teardown and reporting `dropped`.

Use `await room.leave()` to exit presence while keeping the room reusable. Use
`await room.dispose()` for graceful departure followed by permanent teardown.
The related `autoCloseWhenAlone` option is now `autoDisposeWhenAlone`.
