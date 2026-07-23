# Design spike: `peerReplaced` / `peerReconnected`

Status: **not implemented, descoped.** This captures the problem and the options
so the decision can be made later without re-deriving it. See the locked plan in
[room-presence-reconnect-plan.md](finished/room-presence-reconnect-plan.md).

## Problem

Departure reasons do not solve this replacement problem. The room can now know
whether a member disappeared through explicit leave or an unclean drop, but a
same-ID socket replacement may never remove the member from a snapshot. It
still requires adapter-provided identity or generation semantics.

The room de-dupes presence by `memberId` and drives connections from membership:
a `memberId` leaving the snapshot tears down its session, and the same `memberId`
reappearing builds a fresh one. From de-duped presence alone, the room cannot
tell these two cases apart:

1. **Same peer, refreshed presence row** — the existing peer is still on the same
   live socket; only its presence data (mute, name, heartbeat) changed.
2. **Replacement socket** — the old socket is gone (reload, crash, network blip)
   and a new socket has registered under the same `peerId`.

Both surface as "the row for `peerId` X is still here." A `peerReplaced` /
`peerReconnected` event would let apps react precisely (e.g. keep the UI tile but
expect a new stream, or reset RTT stats) instead of inferring from stream churn.

## Why core can't decide alone

Socket identity lives in the adapter/transport, not in the room. The room only
sees `onPeers` snapshots and the `memberId` strings in them. Nothing in the
current contract distinguishes "same connection" from "new connection, same id."

## Options

### A. Connection / session generation

Thread a monotonically increasing generation (epoch) per `peerId` through
presence or signaling. The room compares the incoming generation against the last
one it saw for that `peerId`; a higher generation means replacement → emit
`peerReplaced` and rebuild the session.

- Pro: deterministic; core owns the event; works across any adapter that can
  supply a generation.
- Con: expands the presence/signaling contract (every adapter must produce a
  stable, increasing generation per registration); migration cost for existing
  adapters; needs a tie-break rule for clock/order skew.

### B. Adapter-signalled replacement

The adapter — which alone knows socket identity — tells the room when a `peerId`
was replaced, via either a presence field the room interprets or a dedicated
adapter→room signal.

- Pro: no generation bookkeeping in core; matches where the knowledge actually
  lives.
- Con: pushes correctness into every adapter; inconsistent semantics across
  adapters; harder to test centrally.

## Open questions

- Is `peerReplaced` (same id, new connection) distinct enough from
  `peerReconnected` (left then returned) to warrant two events, or is one enough?
- Does any consumer actually need this, or is the current rebuild-on-membership
  behavior sufficient in practice? Confirm demand before adding contract surface.
- If A: where does the generation live — presence data, a reserved field, or the
  signaling envelope?

## Recommendation

Defer until a concrete consumer need appears. If it does, prefer **A (generation)**
only if a clean, low-friction way to source the generation exists; otherwise
**B** keeps core simple. Do not add the event speculatively — it is contract
surface that is hard to remove.
