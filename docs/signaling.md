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
    callback: (
      peers:
        | string[]
        | Array<{ memberId: string; data?: Record<string, unknown> }>,
    ) => void,
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
can keep emitting `string[]`; presence-data-aware adapters emit structured members:
`{ memberId, data }`. `P2PRoom.members` remains the `string[]` ID projection,
while `P2PRoom.memberPresence` exposes the structured snapshot. For mid-call
changes like mute state or ringing-to-joined transitions, implement
`updatePresenceData(peerId, data)`. If an adapter does not provide that method,
`P2PRoom.setPresenceData(data)` falls back to `refreshPresence(peerId, data)`
when available.

`cleanupSignaling()` is an optional permanent teardown hook for adapter-owned
resources. Use it to release provider listeners, sockets, timers, pending
disconnect hooks, or signaling records that are safe for that adapter to own. Do
not assume a room adapter can delete arbitrary backend room state: WebSocket,
Firestore, RTDB, Redis, in-memory, and server-owned signaling backends often
have different retention and authorization rules. Whole-room cleanup should stay
in the adapter or application layer that understands those rules.

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
subscription alive so the app can rejoin the same room later. `room.close()` is
the permanent teardown path: it closes peer connections, unsubscribes from room
presence, closes signaling, releases room-owned media, and makes a best-effort
`leave()` call if the room had joined presence. In browser environments, active
rooms also make a best-effort `leave()` call on `pagehide`, skipping
back/forward cache restores.

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
