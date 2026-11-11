---
'@kidlib/p2p': minor
---

Add stable `error.code` values (exported as `P2P_ERROR_CODES`) to startup failures from `Peer.start()`, `startP2PSession`/`joinP2PSession`, and `P2PRoom`, including errors forwarded by the room `error` event. Covers start/connection/data-channel timeouts, connection failure/closure, data-channel closure, disposal before start, signal buffer overflow, and abort. Messages are unchanged.
