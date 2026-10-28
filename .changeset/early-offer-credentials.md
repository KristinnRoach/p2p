---
"@kidlib/p2p": patch
---

Retain joiner offers and ICE candidates received while initial ICE credentials load, so unbuffered signaling transports do not lose the initial negotiation. Clear retained signals and subscriptions when startup fails, is aborted, or the peer is disposed.
