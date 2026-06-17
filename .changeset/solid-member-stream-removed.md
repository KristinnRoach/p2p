---
"@kidlib/p2p": patch
---

Update the Solid room adapter's `remoteMemberStreams` signal when core emits `memberStreamRemoved`, so Solid consumers clear failed or aborted remote streams even when membership does not change.

