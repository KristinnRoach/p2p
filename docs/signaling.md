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
  join(peerId: string): void | Promise<void>;
  leave(peerId: string): void | Promise<void>;
  onPeers(callback: (peerIds: string[]) => void): void | (() => void);
  createPeerSignaling(options: {
    localPeerId: string;
    remotePeerId: string;
  }): RtcSignalingSource;
  close?(): void;
}
```

Presence cleanup is provider-owned. `leave(peerId)` is the explicit cleanup
path; adapters can also use `close()`, heartbeat/TTL, server presence, or a
combination to remove peers that disappear without calling `leave()`.

## Normalizing a signaling source

`createPairSignaling` and `createRoomSignaling` validate a raw source and add lifecycle management:

- Throws immediately if required methods are missing
- Callbacks stop firing after `close()`
- `close()` calls all active unsubscribe functions

```js
import { createPairSignaling, createRoomSignaling } from '@kidlib/p2p';

const pairSignaling = createPairSignaling({
  sendOffer, sendAnswer, onOffer, onAnswer, sendCandidate, onRemoteCandidate,
});
// pairSignaling.close() unsubscribes all active listeners

const roomSignaling = createRoomSignaling({
  join, leave, onPeers, createPeerSignaling,
});
// roomSignaling.close() closes all pair signalings and the room subscription
```

`joinP2PRoom` and `watchP2PRoom` normalize room signaling internally.
`watchP2PRoom` subscribes to `onPeers()` without calling `join()`, then
`room.join()` enters presence and starts pair connections. `room.leave()` calls
`leave()` and closes active pair connections while keeping the peer-list
subscription alive. `room.close()` is the permanent teardown path.

For `startP2PSession`, `joinP2PSession`, `Peer`, and data-only helpers, pass a raw
`RtcSignalingSource` or wrap it with `createPairSignaling` yourself when you
want normalized listener cleanup.
