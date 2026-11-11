---
'@kidlib/p2p': patch
---

Enforce a finite `memberCapacity` when presence includes the local peer, so members beyond the limit no longer get a session carrying local media. Admitted members keep their slots, and a refused member is admitted once a slot frees up.
