---
"@kidlib/p2p": patch
---

Retain joiner offers and ICE candidates received while initial ICE credentials load, so unbuffered signaling transports do not lose the initial negotiation. Clear retained signals and subscriptions when startup fails, is aborted, or the peer is disposed.

Bound retained startup signaling by message count and serialized payload size, failing and disposing on overflow. Stop queued offers after the initial negotiation fails.
