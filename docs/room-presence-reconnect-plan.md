# Room presence and reconnect plan

This plan is optimized for small, fast PRs with immediate consumer value. After
the duplicate room state guard PR merges, duplicate presence snapshots are
handled in core and the next independent slice is the Solid media playback
helper.

## Done When This PR Merges: Duplicate Room State Guards

This PR completes the first fast slice:

- Incoming presence snapshots are de-duped by `memberId` before assigning
  `_memberPresence` / `_memberIds`.
- `remoteMemberStreams` is de-duped defensively even if `_memberIds` somehow
  contains duplicates.
- Duplicate incoming `memberId`s emit a logger-backed warning through
  `setLogger()`.
- Focused tests cover duplicate presence snapshots and duplicate stream
  prevention.

Consumer impact:

- Duplicate signaling snapshots no longer inflate `members`, `memberPresence`,
  or `memberCount`.
- A transient duplicate presence row cannot render the same remote stream twice.
- Apps that wire `setLogger()` can spot bad adapter snapshots during
  development without the package writing directly to `console`.

## Next Independent PR: Solid Playback Helper

This slice does not depend on the duplicate room state guards landing first.

Scope:

- Add a small reusable helper such as `attachMediaStream(video, stream, options)`
  / `createMediaPlayback()`.
- Standardize the browser playback handshake:
  `srcObject` -> `play()` -> blocked state -> user gesture retry.
- Expose `playbackBlocked` and `resumePlayback()` so apps can show one
  "Continue call" button and call `resumePlayback()` from that click.
- Leave all UI prompt/button rendering to the consuming app.

Why separate:

- It is independent from room presence and can ship quickly.
- It should not be hidden inside `useP2PRoom`, because the adapter does not own
  the app's actual media elements.

## Follow-Up PRs

These remain useful but should not block the two fast PRs above.

### Stream Removal Lifecycle

- Emit a dedicated `memberStreamRemoved` event when a remote stream is removed
  from `remoteStreams`.
- Ensure remote streams are removed when a peer connection closes, fails, is
  aborted, or leaves via presence.
- Keep `memberLeft` behavior unchanged.

### Alone / Auto-Exit Ergonomics

- Prefer an `alone` / `roomAlone` event over `roomEmpty`, unless `roomEmpty` is
  explicitly documented as "empty of remote members".
- Add optional `autoCloseWhenAlone` / `autoLeaveWhenAlone` for common 1:1 call
  flows.
- Evaluate against de-duped membership after the local peer has joined.

### Signaling Reconnect And Stale Presence

- Document recommended singleton `peerId` semantics: latest join wins.
- Document that stale sockets should stop receiving relayed messages.
- Expand `refreshPresence` / TTL examples for peers that disappear without a
  clean `leave()`.
- Clarify the distinct roles of `pagehide` leave, `cleanupSignaling()`, and
  heartbeat expiry.
- Add same-`peerId` reload/reconnect tests or adapter examples.

Open design question:

- Core cannot reliably emit `peerReplaced` / `peerReconnected` from de-duped
  presence alone. That likely needs adapter semantics, or a connection/session
  generation, so the room can distinguish a refreshed same-peer presence row
  from a fresh socket replacing a stale one.

