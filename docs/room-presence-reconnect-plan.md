# Room presence and reconnect plan

This captures the current assessment of presence, duplicate member IDs,
same-`peerId` reloads, stale peers, reconnects, and UI stream removal. The
consumer-facing goal is to make reload/reconnect behavior predictable without
requiring every app to patch around duplicate presence rows, stale sockets, or
missing stream-removal signals.

## PR split

Do not put all of this in one PR. There are at least three different risk
profiles here:

1. Defensive correctness and docs: low risk, mostly internal behavior and
   adapter guidance. This should be the first PR.
2. UI lifecycle helpers: small API additions for stream removal and optional
   auto-leave/auto-close behavior. This can follow after the defensive fixes.
3. Reconnect/session replacement semantics: larger API and adapter contract
   work. This needs its own design pass and tests because behavior depends on
   whether signaling relays messages through long-lived peer IDs, sockets, or
   connection/session IDs.

## Recommended first PR

These are quick, easy, and beneficial from a consuming app:

- De-dupe presence snapshots by `memberId` before storing `members`,
  `memberPresence`, and `memberCount`.
- De-dupe `remoteMemberStreams` by `memberId` so duplicate presence cannot
  render the same stream multiple times.
- Add a development warning when a presence snapshot contains duplicate member
  IDs.
- Document signaling adapter expectations for reload/reconnect cases:
  `peerId` is a singleton room identity, latest join wins, stale sockets must
  stop receiving routed messages, and `onPeers` snapshots must not contain
  duplicate peer/member IDs.
- Add tests for duplicate presence snapshots and duplicate-stream prevention.

These changes should be safe for consumers because duplicate peer IDs are
already nonsensical in the public room model. De-duping makes the current API
match the documented shape: one room member and one rendered remote stream per
`memberId`.

## Good second PR

These are feasible and useful, but they are public behavior/API additions and
should be separate from the first defensive PR:

- Clear remote streams when a peer session closes, fails, or is aborted, not
  only when presence changes.
- Emit a reliable `memberStreamRemoved` event when a remote stream should be
  removed from UI. Prefer this over overloading `memberLeft`, because a peer can
  still be present while its current WebRTC session has failed or is being
  replaced.
- Add tests for remote hangup after same-`peerId` replacement: presence clears
  or remains single-entry, the remote stream is removed, and the room can
  auto-exit if that option is enabled.

This is not just cosmetic. Solid consumers currently update
`remoteMemberStreams()` from room events, so they need an event that fires
whenever the stream is no longer valid, independent of whether presence changed.

## Optional small API PR

`autoCloseWhenAlone` / `autoLeaveWhenAlone` is feasible and probably useful, but
it should be opt-in and documented carefully.

Recommended semantics:

- Only evaluate after the local peer has joined.
- Trigger when the de-duped room membership contains only the local `peerId`.
- `autoLeaveWhenAlone` calls `leave()` and keeps watching the room.
- `autoCloseWhenAlone` calls `close()` and tears down signaling/media.
- If both are supplied, reject the options or make `autoCloseWhenAlone` win; do
  not silently do both.

This is not purely beneficial for every app because some rooms intentionally
wait alone for another participant. Keep it separate from correctness fixes.

## Larger design track

These suggestions belong together, but not in the first PR:

- Treat `peerId` as a singleton room identity in recommended signaling
  semantics: latest connection wins.
- Add explicit room events such as `peerReplaced`, `peerReconnected`,
  `peerStale`, and `roomEmpty`.
- Expose a `recovering` / `reconnecting` room state for transient signaling
  disconnects.
- On signaling reconnect, restart affected peer sessions with fresh SDP/ICE
  when relay signaling is ephemeral.
- Add optional stale-peer timeout / heartbeat handling for peers that disappear
  without a clean leave.
- Add tests for reload during active call: old socket still closing, same
  `peerId` rejoins, no duplicate streams, and relays target the latest socket.

These affect the room state machine, signaling adapter contracts, and
potentially peer session lifecycle. The main design question is whether
replacement is modeled at the room layer using only `peerId`, or whether
signaling adapters expose a connection/session generation so the room can
distinguish a fresh peer from a stale socket with the same identity.

## Media playback helpers

These are independent of room presence and should not be bundled with the
duplicate/reconnect work:

- Provide a Solid adapter event or helper for video playback blocked by browser
  autoplay policy, while leaving the UI prompt to the app.
- Consider `playAllMedia()` / `resumePlayback()` in the Solid adapter so apps
  can call it from a user gesture.

Feasibility is medium. The helper is straightforward, but the API needs to be
honest about browser limits: it can retry `HTMLMediaElement.play()` from an app
gesture, but it cannot bypass autoplay policy. This belongs in a Solid/media
ergonomics PR.

## Suggested order

1. Defensive de-dupe plus signaling docs and tests.
2. Reliable stream-removal event plus session close/fail cleanup tests.
3. Optional alone-room auto-leave/auto-close behavior.
4. Same-`peerId` latest-join-wins adapter semantics and reconnect/session
   replacement design.
5. Solid autoplay playback helpers.

