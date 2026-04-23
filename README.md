# @kidlib/p2p

Signaling-agnostic WebRTC helpers for peer connections, data channels, ICE
candidate exchange, SDP handling, track attachment, and RTT diagnostics.

The package does not include a signaling backend. Consumers provide a transport
for offer, answer, and ICE candidate exchange, so it can be used with Firebase,
WebSockets, WebTransport, or another application-specific channel.

## Install

```bash
pnpm add @kidlib/p2p
```

## Usage

```js
import { Peer } from '@kidlib/p2p';

const peer = new Peer({
  role: 'initiator',
  signaling,
  dataChannel: true,
});

peer.on('message', ({ data }) => {
  console.log(data);
});

await peer.start();
```

`signaling` must implement the `DataSignalingChannel` contract documented in
`src/signaling-transport.js`.

Provider adapters can be normalized before passing them to `Peer`:

```js
import { createSignalingChannel } from '@kidlib/p2p';

const signaling = createSignalingChannel({
  sendOffer,
  sendAnswer,
  onOffer,
  onAnswer,
  sendCandidate,
  onRemoteCandidate,
});
```

`createSignalingChannel()` returns a normalized signaling object with a
`close()` method. Calling `close()` prevents callbacks registered through the
wrapper (`onOffer`, `onAnswer`, `onRemoteCandidate`) from firing again and
prevents new subscriptions. If the provider returned unsubscribe functions, they
are called too. It does not close the underlying provider connection unless
those provider unsubscribe functions do so.

Remote media can be assembled without touching DOM elements:

```js
import { attachRemoteStream } from '@kidlib/p2p';

const detach = attachRemoteStream(peer, {
  onStream({ stream }) {
    renderRemoteStream(stream);
  },
});
```

## Exports

- `Peer`, `PEER_STATES`
- `createDataChannel`, `joinDataChannel`, `closeDataConnection`
- `setLogger`
- `createSignalingChannel`
- `attachRemoteStream`
- Power-user subpaths for `config`, `ice`, `remote-stream`, `rtt`, `sdp`,
  `signaling-channel`, `signaling-transport`, and `tracks`

## Development

```bash
pnpm install
pnpm test
```

The test suite uses Vitest browser mode with Playwright Chromium so the
end-to-end peer tests run against real browser WebRTC APIs.
