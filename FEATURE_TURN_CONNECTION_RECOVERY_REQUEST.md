Feature request: first-class TURN / connection-recovery support in @kidlib/p2p

Context: consumers (HangVidU) hit two production issues on 1:1 calls — remote
media freezing on network-path changes (WiFi↔cellular, CGNAT rebind), and no
recovery when it doesn't self-heal. Root causes are lib-level.

Please consider:

1. ICE restart on connection failure (highest priority — only the lib can do
   this). Peer currently only _logs_ connectionState (peer.js:520). When
   pc.connectionState / iceConnectionState goes 'disconnected' or 'failed',
   trigger pc.restartIce() + renegotiate over the existing pair signaling,
   with backoff and a cap. Expose it as opt-in behavior (e.g.
   `reconnect: { iceRestart: true, maxAttempts, timeoutMs }`) and emit events
   so consumers can show "reconnecting…" UI. Today a path flap = permanently
   frozen media until manual redial.

2. TURN credential ergonomics. rtcConfig override already works for static
   creds, but real TURN providers (Cloudflare Calls, Twilio) issue short-lived
   creds needing refresh. A documented pattern or small helper for
   "async iceServers provider + refresh before expiry" would prevent everyone
   reinventing it. Not asking for a bundled TURN server — just make the
   ephemeral-cred flow a first-class, documented path.

3. (Optional) Docs note that the default config is STUN-only and will fail on
   symmetric NAT / restrictive mobile networks without a TURN server.

Follow-up, possibly folds into the ICE-restart/reconnect item:

The departure-reason portion is implemented separately by
`FEATURE_SLICE_LEFT_VS_DROPPED_SIGNAL.md`; presence grace remains app-owned for
now.

Consider surfacing leave-vs-drop natively. The signaling layer already knows
the difference — an explicit `leave` message vs a socket/presence loss — but
the room collapses both into the same member-list change, so consumers can't
tell an intentional hangup from a dropped peer.

Requests:

1. Add `reason: 'left' | 'dropped'` to `memberLeft` (and the `alone` detail),
   derived from whether a signaling `leave` was seen before the member vanished.
2. Optional `reconnect: { graceMs }` room option: for `dropped` peers, delay
   `alone`/teardown for the window and emit `reconnecting` /
   `reconnected` / `reconnectFailed` events.

This would let us delete an app-side data-channel `bye` workaround we built for
exactly this — and it's more reliable, since a signaling `leave` survives even
when the data channel is already dead. Backend note: the signaling snapshot
(our Durable Object's `broadcastPeers`) would need to carry the reason.
