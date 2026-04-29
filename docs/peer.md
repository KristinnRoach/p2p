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

## Data-only connections

For data channels without media streams:

```js
import { createDataChannel, joinDataChannel, closeDataConnection } from '@kidlib/p2p';

// Initiator
const { pc, dataChannel } = await createDataChannel(signaling);

// Joiner
const { pc, dataChannel } = await joinDataChannel(signaling);

closeDataConnection(pc);
```

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
