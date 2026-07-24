---
"@kidlib/p2p": patch
---

Serialize `useP2PRoom` lifecycle transitions on a single chain. `watch()`,
`dispose()`, and teardown of superseded rooms now run one at a time, so a
second `watch()` can no longer create a room while an earlier creation is still
in flight and use the same peer identity concurrently. A superseded room is
never published through the `room` signal, and a rejected creation or disposal
no longer blocks later transitions.
