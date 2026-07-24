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

### Ephemeral TURN credentials

`Peer`, `startP2PSession`, and `joinP2PSession` accept
`iceServersProvider` and `iceServersRefreshMarginMs`:

```js
const session = await startP2PSession({
  signaling,
  iceServersProvider: async ({ reason, signal }) => {
    const response = await fetch('/api/turn-credentials', { signal });
    if (!response.ok) throw new Error(`TURN fetch failed (${reason})`);
    return response.json();
  },
});
```

The provider must resolve to a non-empty `iceServers` array and may include
`expiresAt` as epoch milliseconds. Without expiry it runs once. Otherwise the
package refreshes before expiry (by default, the smaller of 60 seconds or 10%
of the credential lifetime), applies the new configuration to the live
connection, and does not restart ICE. An explicit non-negative
`iceServersRefreshMarginMs` overrides that margin.
Overrides at or above the observed credential lifetime are clamped just below
the lifetime to prevent an immediate refresh loop.

Initial failure prevents connection construction. Refresh failure keeps
unexpired credentials and retries briefly; expired credentials are never
silently replaced with the default STUN server. Disposal aborts the provider
request and clears refresh work. When both `rtcConfig.iceServers` and a
provider are present, a successful provider result replaces only `iceServers`.

Your browser callback should call an authenticated application backend.
Cloudflare API tokens, Twilio auth tokens, and similar provider secrets must
never be shipped to the browser. Normalize provider responses on the backend
or in the callback without adding a provider SDK:

```js
// Cloudflare-style response
return {
  iceServers: response.iceServers,
  expiresAt: Date.now() + response.ttl * 1000,
};

// Twilio-style response
return {
  iceServers: response.ice_servers,
  expiresAt: Date.now() + response.ttl * 1000,
};
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
