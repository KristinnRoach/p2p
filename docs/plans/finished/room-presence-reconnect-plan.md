# Room presence and reconnect plan

> **Status: complete.** All planned PRs shipped (v0.2.0–v0.2.2). The only
> remaining item, `peerReplaced` / `peerReconnected`, was deliberately descoped
> to a separate spike: [peer-replaced-design.md](../peer-replaced-design.md).

This plan is optimized for small, fast PRs with immediate consumer value.

## Shipped (v0.2.0)

- **Duplicate room state guards** — presence snapshots de-duped by `memberId`
  in core (details below).
- **Solid media playback helper** — `attachMediaStream()` / `createMediaPlayback()`
  in `@kidlib/p2p/solid` (details below).

## Shipped (v0.2.1)

- **PR A — Stream removal lifecycle + Alone/auto-exit ergonomics** (#23) —
  `memberStreamRemoved` event (+ `peerStreamRemoved` alias), `alone` event, and
  `autoCloseWhenAlone` option. Released as a patch.
- **PR B — Signaling reconnect & stale presence** (#24) — docs + same-`peerId`
  reload tests only; no source changes.

## Shipped (v0.2.2)

- **Solid stream removal bridge** — the Solid adapter updates
  `remoteMemberStreams()` when core emits `memberStreamRemoved`, so Solid
  consumers clear failed or aborted remote streams even when membership does not
  change.

Locked decisions:

- Event/option naming: `alone` event + `autoCloseWhenAlone` option (not
  `roomEmpty` / `roomAlone`). `memberStreamRemoved` gets a `peerStreamRemoved`
  alias to match the existing `peerLeft` / `peerStream` pattern.
- `peerReplaced` / `peerReconnected` is **descoped** from both PRs. It needs a
  connection/session generation or adapter semantics (see open question below)
  and must not block this work. Treat as a separate design spike later.

## Done: Duplicate Room State Guards (shipped)

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

## Done: Solid Playback Helper (shipped)

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

## PR A: Stream Removal Lifecycle + Alone/Auto-Exit Ergonomics

Combined into one PR; both touch `_closeMember` and membership in
`src/room.js`. Shipped as a single changeset (released as a patch, v0.2.1).

### Stream Removal Lifecycle

- Emit a dedicated `memberStreamRemoved` event (with `peerStreamRemoved` alias)
  when a remote stream is removed from `remoteStreams`.
- Ensure remote streams are removed when a peer connection closes, fails, is
  aborted, or leaves via presence.
- Keep `memberLeft` behavior unchanged.

### Alone / Auto-Exit Ergonomics

- Emit an `alone` event when the local peer is the only remaining member.
- Add optional `autoCloseWhenAlone` for common 1:1 call flows.
- Evaluate against de-duped membership after the local peer has joined.

## PR B: Signaling Reconnect And Stale Presence

Docs + tests only. `peerReplaced` / `peerReconnected` is descoped (see open
question).

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
  from a fresh socket replacing a stale one. Captured in
  [peer-replaced-design.md](../peer-replaced-design.md).
