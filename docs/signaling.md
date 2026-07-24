# Signaling

`@kidlib/p2p` is signaling-agnostic. You provide the transport; the library handles WebRTC.

## RtcSignalingSource

The 1:1 pair signaling contract required by `startP2PSession`, `joinP2PSession`, and `Peer`:

```ts
interface RtcSignalingSource {
  sendOffer(offer: RTCSessionDescriptionInit): void | Promise<void>;
  sendAnswer(answer: RTCSessionDescriptionInit): void | Promise<void>;
  onOffer(callback: (offer: RTCSessionDescriptionInit) => void): void | (() => void);
  onAnswer(callback: (answer: RTCSessionDescriptionInit) => void): void | (() => void);
  sendCandidate(candidate: RTCIceCandidateInit): void | Promise<void>;
  onRemoteCandidate(callback: (candidate: RTCIceCandidateInit) => void): void | (() => void);
}
```

`onOffer`, `onAnswer`, and `onRemoteCandidate` may optionally return an unsubscribe function.

## P2PRoomSignaling

The room-level contract required by `joinP2PRoom`. Manages presence and creates per-pair signaling:

```ts
interface P2PRoomSignaling {
  join(peerId: string, data?: Record<string, unknown>): void | Promise<void>;
  leave(peerId: string): void | Promise<void>;
  refreshPresence?(
    peerId: string,
    data?: Record<string, unknown>,
  ): void | Promise<void>;
  updatePresenceData?(
    peerId: string,
    data: Record<string, unknown>,
  ): void | Promise<void>;
  onPeers(
    callback: (snapshot: {
      members: Array<{
        memberId: string;
        data?: Record<string, unknown>;
      }>;
      departed?: Array<{ memberId: string; reason: 'left' }>;
    }) => void,
  ): void | (() => void);
  createPeerSignaling(options: {
    localPeerId: string;
    remotePeerId: string;
  }): RtcSignalingSource;
  cleanupSignaling?(): void | Promise<void>;
}
```

`onPeers` is a hard contract: it MUST emit an initial presence snapshot to
every subscriber — including watchers that have never called `join()` — and
keep all subscribers updated on every change. `watchP2PRoom` and capacity
enforcement (`memberCapacity`) both evaluate against this feed; a backend that
only notifies joined peers breaks both (the room joins blind against an empty
member list). `P2PRoom` waits briefly for the first snapshot before joining,
but that is a degraded fallback, not a substitute.

Presence cleanup is provider-owned. `leave(peerId)` is the explicit cleanup
path. If an adapter implements `refreshPresence(peerId)`, `P2PRoom` calls it
periodically after joining so the adapter can expire peers that disappear
without calling `leave()`. Adapters can also use `cleanupSignaling()`, server
presence, or a combination of these mechanisms.

Presence may carry app-defined data for each member. Keep it object-shaped and
generic: `{ displayName: 'Ada', muted: true }`, for example. Existing adapters
emit structured members as `{ memberId, data }` inside the snapshot envelope.
`P2PRoom.members` remains the `string[]` ID projection, while
`P2PRoom.memberPresence` exposes the structured snapshot. For mid-call changes
like mute state or ringing-to-joined transitions, implement
`updatePresenceData(peerId, data)`. If an adapter does not provide that method,
`P2PRoom.setPresenceData(data)` falls back to `refreshPresence(peerId, data)`
when available.

When a member explicitly leaves, include
`{ memberId, reason: 'left' }` in `departed` on the same snapshot where that
member first disappears. Missing departure metadata is intentionally treated as
`dropped`. The room exposes this on `memberLeft` and `peerLeft`. If a transition
makes the room alone, `alone.reason` is `left` only when every member removed in
that transition was explicit; otherwise it is `dropped`.

`cleanupSignaling()` is an optional permanent teardown hook for adapter-owned
resources. Use it to release provider listeners, sockets, timers, pending
disconnect hooks, or signaling records that are safe for that adapter to own. Do
not assume a room adapter can delete arbitrary backend room state: WebSocket,
Firestore, RTDB, Redis, in-memory, and server-owned signaling backends often
have different retention and authorization rules. Whole-room cleanup should stay
in the adapter or application layer that understands those rules.

## Reconnect and stale presence

`peerId` is a singleton identity. Within any one `onPeers` snapshot, duplicate
`memberId`s are de-duped and the last entry wins. Emit a returning peer's fresh
row last (or just emit it once) so the latest join is the one the room keeps.
The room drives connections from membership: when a `memberId` drops out of the
snapshot its session is torn down, and when the same `memberId` reappears a new
session is built — a stale connection is never reused.

Two independent mechanisms remove a peer that goes away:

- **`leave(peerId)`** — explicit, immediate departure. Called and awaited by
  `room.leave()` and `room.dispose()`.
- **`refreshPresence(peerId)` + TTL** — for peers that vanish without a clean
  `leave()`. While joined, the room calls `refreshPresence` on a short interval;
  the adapter or backend expires any peer whose presence record is older than a
  TTL. Size the TTL to a small multiple of the refresh interval so a brief gap
  does not evict a live peer.

Page refresh, navigation, tab close, crashes, and lost connectivity are not
explicit leave signals. They flow through socket disconnect or presence expiry
and are reported as `dropped`, allowing consumers to apply reconnection grace
consistently across transports.

When a socket becomes stale — replaced by a newer one for the same `peerId`, or
expired by TTL — the adapter must stop relaying signaling messages to it.
Otherwise offers, answers, and candidates fan out to a dead connection and the
fresh one may never converge.

### Example: TTL expiry and stale-socket guard

A minimal in-memory sketch. A real adapter would back `records` with the
provider (RTDB, Firestore, Redis, a server table). The room calls
`refreshPresence(peerId)` on a short interval while joined; expiry runs off a
timer and removes any record older than the TTL. Each `peerId` maps to exactly
one live socket, so a newer registration retires the previous one and signaling
is only relayed to the current socket.

```js
const TTL_MS = 20_000; // a few times the room's refresh interval

const records = new Map(); // peerId -> { lastSeen, socket }

function publishPeers() {
  const peers = [...records.keys()];
  for (const callback of peerListeners) callback(peers);
}

const signaling = {
  join(peerId) {
    // A reconnecting peerId replaces its own previous socket: latest join wins.
    records.set(peerId, { lastSeen: Date.now(), socket: currentSocket(peerId) });
    publishPeers();
  },
  leave(peerId) {
    records.delete(peerId);
    publishPeers();
  },
  refreshPresence(peerId) {
    const record = records.get(peerId);
    if (record) record.lastSeen = Date.now();
  },
  onPeers(callback) {
    peerListeners.add(callback);
    callback([...records.keys()]); // required initial snapshot
    return () => peerListeners.delete(callback);
  },
  // createPeerSignaling, cleanupSignaling...
};

// Expire peers that stopped refreshing (closed tab, crash, lost connectivity).
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [peerId, record] of records) {
    if (now - record.lastSeen > TTL_MS) {
      records.delete(peerId);
      changed = true;
    }
  }
  if (changed) publishPeers();
}, TTL_MS / 2);

// Only relay signaling to the peer's current socket. A stale socket (already
// replaced or expired) is never addressed, so a fresh connection can converge.
function relayTo(peerId, envelope) {
  records.get(peerId)?.socket.send(envelope);
}
```

## Normalizing a signaling source

`createPairSignaling` and `createRoomSignaling` validate a raw source and add lifecycle management:

- Throws immediately if required methods are missing
- Callbacks stop firing after `close()`
- `close()` calls all active unsubscribe functions
- For room signaling, `close()` also calls an optional provider
  `cleanupSignaling()` hook and may return a promise when provider cleanup is
  async

```js
import { createPairSignaling, createRoomSignaling } from '@kidlib/p2p';

const pairSignaling = createPairSignaling({
  sendOffer, sendAnswer, onOffer, onAnswer, sendCandidate, onRemoteCandidate,
});
// pairSignaling.close() unsubscribes active listeners

const roomSignaling = createRoomSignaling({
  join, leave, onPeers, createPeerSignaling, cleanupSignaling,
});
// roomSignaling.close() closes pair signalings, the room subscription, and cleanupSignaling()
```

`joinP2PRoom` and `watchP2PRoom` normalize room signaling internally.
`watchP2PRoom` subscribes to `onPeers()` without calling `join()`, then
`room.join()` enters presence and starts pair connections. `room.leave()` calls
`leave()` and closes active pair connections while keeping the peer-list
subscription alive so the app can rejoin the same room later.
`room.dispose()` is the permanent teardown path: it closes local peer
connections and owned media immediately, then awaits `leave()` before closing
room signaling. This guarantees that an intentional departure reaches
network-backed signaling before its transport is torn down.

For `startP2PSession`, `joinP2PSession`, `Peer`, and data-only helpers, pass a raw
`RtcSignalingSource` or wrap it with `createPairSignaling` yourself when you
want normalized listener cleanup.

## Adapting relay transports

Relay transports usually expose one addressed message stream instead of
separate `sendOffer`, `sendAnswer`, and `sendCandidate` channels. Use
`createRelayPeerSignaling` inside a room adapter's `createPeerSignaling()` to
turn that stream into the pair signaling contract:

```js
import { createRelayPeerSignaling } from '@kidlib/p2p';

const messageListeners = new Set();

socket.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.to !== localPeerId) return;

  for (const callback of messageListeners) {
    callback(msg.from, msg.envelope);
  }
});

const roomSignaling = {
  // join, leave, onPeers...
  createPeerSignaling({ localPeerId, remotePeerId }) {
    return createRelayPeerSignaling({
      remotePeerId,
      send: (toPeerId, envelope) =>
        socket.send(JSON.stringify({
          type: 'signal',
          from: localPeerId,
          to: toPeerId,
          envelope,
        })),
      onMessage(callback) {
        messageListeners.add(callback);
        return () => messageListeners.delete(callback);
      },
    });
  },
};
```

The helper sends and receives these envelopes:

```ts
type RelaySignalingEnvelope =
  | { kind: 'offer'; offer: RTCSessionDescriptionInit }
  | { kind: 'answer'; answer: RTCSessionDescriptionInit }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit };
```

Incoming messages from other peers and unknown envelope kinds are ignored.
`close()` removes the relay listener and all pair listeners.
