# Slice: Departure reason on member removal

Scope: `left` vs `dropped` on room member departure. Nothing else from
FEATURE_TURN_CONNECTION_RECOVERY_REQUEST.md — no ICE recovery, no TURN
credential provider, no presence grace window in the library.

## What's needed

### 1. Signaling port

`P2PRoomSignaling` uses an envelope whose departure field is optional:

```ts
onPeers(cb: (snapshot: {
  members: P2PRoomPresenceMember[];
  departed?: Array<{ memberId: string; reason: 'left' }>;
}) => void): () => void;
```

`departed` accompanies the snapshot in which the member first disappears, so
ordering is atomic by construction. Absent field = no information.

### 2. Room events

`memberLeft` and `alone` carry `reason: 'left' | 'dropped'`.

Derivation: a member gone from members is 'left' if this snapshot's
departed names it, 'dropped' otherwise. Default is 'dropped' because
absence of an explicit leave is exactly what a drop looks like.

Mirror onto the deprecated peerLeft for consistency.

For a transition that makes a mesh room alone, the aggregate reason is `left`
only when every removed member is listed as explicitly left. If any removal has
no explicit marker, the reason is `dropped`.

## Explicitly out of scope
Skipping these is deliberate, not an oversight — each answers a question from
FEATURE_TURN_CONNECTION_RECOVERY_QUESTIONS.md section F:

Legacy snapshot shapes (Q60–62). The consuming app and bundled adapters move
to the envelope in the same release. There is no `unknown` reason.

Durable departure retention (Q57). A subscriber whose socket is down
across the departure broadcast reconnects to a snapshot with no departed
and reads 'dropped'. That is the correct reading for that case.

Generation/session IDs (Q59) and de-duplication (Q64). The HangVidU
Durable Object already evicts a stale socket on same-ID rejoin
(replaceExistingPeerSocket), so there is no stale-incarnation window to
guard yet. Revisit only if that changes.

`presenceRecovery` / grace window (section G). HangVidU implements this
app-side today and it works. Do not add a room option for it.

A third `removed` reason (Q55). No moderation/kick feature exists.
Keep the union exactly 'left' | 'dropped'.

## Consumer integration

The backend already sends what's needed. room.leave() and
cleanupSignaling() both emit {t:'leave'} over the signaling WebSocket; the
Durable Object receives it and currently discards the distinction by calling
the same broadcastPeers() as an unclean socket close. The DO change is to tag
that broadcast — a few lines.
