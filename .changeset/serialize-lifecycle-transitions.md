---
"@kidlib/p2p": patch
---

Serialize `useP2PRoom` lifecycle transitions on a single chain. `watch()`,
`dispose()`, and teardown of superseded rooms now run one at a time, so a
second `watch()` can no longer start creating a room while an earlier creation
is still in flight — which previously left two rooms using the same peer
identity and signaling at once. A superseded room is never published through
the `room` signal, and a rejected creation or disposal no longer blocks later
transitions. `leave()` no longer writes the left room's membership and streams
back over the signals when a `watch()` supersedes it mid-call.
