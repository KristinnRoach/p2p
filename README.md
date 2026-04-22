# @kidlib/p2p

Signaling-agnostic WebRTC helpers for peer connections, data channels, ICE
candidate exchange, SDP handling, track attachment, RTT diagnostics, and room ID
generation.

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

## Exports

- `Peer`, `PEER_STATES`
- `createDataChannel`, `joinDataChannel`, `closeDataConnection`
- `generateRoomId`
- `setLogger`
- Power-user subpaths for `config`, `ice`, `rtt`, `sdp`, `tracks`, and `utils`

## Development

```bash
pnpm install
pnpm test
```

The test suite uses Vitest browser mode with Playwright Chromium so the
end-to-end peer tests run against real browser WebRTC APIs.
