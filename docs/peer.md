# Lower-level API

## Peer

Direct control over a single WebRTC peer connection. Use this when `P2PSession` lifecycle management doesn't fit your use case.

```js
import { Peer, PEER_STATES } from '@kidlib/p2p';

const peer = new Peer({
  role: 'initiator', // or 'joiner'
  signaling,         // RtcSignalingSource
  localStream,
  dataChannel: true,
});

peer.on('statechange', ({ state }) => {
  if (state === PEER_STATES.CONNECTED) console.log('connected');
});

await peer.start({
  startTimeoutMs: 10000,
  signal: abortController.signal,
});

peer.dispose(); // permanent; this Peer cannot be restarted
```

### Opt-in ICE recovery

Pass an `iceRecovery` object to `Peer`, either session factory, or `P2PRoom` to
renegotiate an established connection after ICE fails. Recovery is disabled
when the option is omitted or `false`.

```js
const peer = new Peer({
  role: 'initiator',
  signaling,
  iceRecovery: {
    maxAttempts: 3,
    disconnectedGraceMs: 3000,
    attemptTimeoutMs: 10000,
  },
});

peer.on('iceReconnecting', ({ attempt, maxAttempts, nextDelayMs }) => {});
peer.on('iceReconnected', ({ attempt, durationMs }) => {});
peer.on('iceReconnectFailed', ({ attempts, reason, error }) => {});
```

The original initiator remains the only offerer. A joiner that detects failure
uses the optional signaling extension documented in
[signaling.md](./signaling.md) to request a restart. `failed` starts recovery
immediately; `disconnected` waits for the configured grace period. Recovery
reuses the existing `RTCPeerConnection`, and exhaustion leaves teardown or
redial to the consumer. The `connected` event remains initial-only.

Defaults are 3 attempts, a 3-second disconnected grace period, a 10-second
attempt timeout, and exponential retry delays of 1, 2, then at most 8 seconds.
The numeric backoff controls are `initialBackoffMs`, `backoffFactor`, and
`maxBackoffMs`.

To reserve a sender before negotiation, pass stable local track slots. This is
the lower-level equivalent of the room API described in the README:

```js
const peer = new Peer({
  role: 'initiator',
  signaling,
  localTrackSlots: [
    { id: 'microphone', kind: 'audio', track: microphoneTrack },
    { id: 'primary-video', kind: 'video', track: null },
  ],
});

await peer.start();
await peer.setLocalTrack('primary-video', cameraTrack);
```

Each slot owns a distinct transceiver/sender, including multiple slots of the
same kind. `replaceTrack()` errors are propagated and tracks remain
caller-owned. Without slots, `Peer` retains its original `localStream`
publication behavior.

Peers that publish through slots should declare matching slot kinds in the
same order (a receive-only peer needs no slots): a joiner slot
transceiver with no counterpart m-line in the remote offer never associates, so
its `setLocalTrack()` succeeds but the media is never transmitted.

## attachRemoteStream

Assembles incoming tracks into a `MediaStream` without touching the DOM:

```js
import { attachRemoteStream } from '@kidlib/p2p';

const detach = attachRemoteStream(peer, {
  onStream({ stream }) { /* full MediaStream ready */ },
  onTrack({ track, stream }) { /* individual track arrived */ },
});

detach(); // unsubscribe
```

## setLogger

```js
import { setLogger } from '@kidlib/p2p';

setLogger((...args) => console.log('[p2p]', ...args));
```
