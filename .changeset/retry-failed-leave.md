---
'@kidlib/p2p': patch
---

Retry `signaling.leave()` on `dispose()` when an earlier leave failed. Previously a failed leave cleared the joined state, so `dispose()` skipped the call and adapters relying on explicit removal kept a stale presence entry that counted toward `memberCapacity`.
