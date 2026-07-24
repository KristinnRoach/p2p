---
"@kidlib/p2p": minor
---

Add opt-in, bounded ICE restart recovery across peers, sessions, and rooms.

Note: the `connected` event now fires at most once per `Peer`, even when
`iceRecovery` is disabled. Previously it fired on every transition to
`connected`. Later reconnections continue to be reported via `statechange`.
