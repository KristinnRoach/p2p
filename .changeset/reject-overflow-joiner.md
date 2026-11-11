---
'@kidlib/p2p': patch
---

Reject `join()` with `RoomFullError` when presence lists the local peer past `memberCapacity`. Previously, a peer that lost a simultaneous-join race became active with no connections, since existing members refuse it.
