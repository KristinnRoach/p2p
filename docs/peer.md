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

peer.close();
```

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
