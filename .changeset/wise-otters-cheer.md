---
"@kidlib/p2p": minor
---

Add remote stream removal and alone/auto-exit lifecycle to `P2PRoom`:

- New `memberStreamRemoved` event (with deprecated `peerStreamRemoved` alias) fires whenever a remote stream is dropped — peer left, or the connection closed, failed, or was aborted. `memberLeft` behavior is unchanged.
- New `alone` event fires when the last remote member leaves (the local peer becomes the only member). It does not fire when joining an empty room.
- New `autoCloseWhenAlone` option closes the room automatically when `alone` would fire — convenient for 1:1 call flows.

No breaking changes — all additive. Existing events and `memberLeft` are unchanged, and `autoCloseWhenAlone` defaults to `false`. Note that on a peer leaving you now receive both `memberStreamRemoved` (if that peer had a stream) and the existing `memberLeft`; handle whichever fits, not both, to avoid removing a tile twice.
