---
"@kidlib/p2p": patch
---

Enforce memberCapacity on backends that deliver presence asynchronously: join waits for the first onPeers snapshot before checking capacity, and the watcher-snapshot contract is now documented.
