Feature request: first-class TURN / connection-recovery support in @kidlib/p2p

Context: consumers (HangVidU) hit two production issues on 1:1 calls — remote
media freezing on network-path changes (WiFi↔cellular, CGNAT rebind), and no
recovery when it doesn't self-heal. Root causes are lib-level.

Please consider:

1. ICE restart on connection failure (highest priority — only the lib can do
   this). Peer currently only logs `connectionState` (peer.js:520). Restart
   immediately when `iceConnectionState === 'failed'`; allow transient
   `disconnected` states a configurable grace period first. Continue observing
   `connectionState` for diagnostics, but do not automatically ICE-restart a
   generic connection failure because it may be DTLS-related. Renegotiate over
   the existing pair signaling with backoff and an attempt cap. Expose this as
   opt-in behavior, for example:

   ```js
   iceRecovery: {
     maxAttempts: 3,
     disconnectedGraceMs: 3000,
     attemptTimeoutMs: 10000,
   }
   ```

   Omitting `iceRecovery` or setting it to `false` keeps recovery disabled.
   Providing the options object enables it.

   Emit ICE-specific recovery events so consumers can show “reconnecting…”
   UI. Today a path flap can leave media frozen until manual redial.

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

The departure-reason slice now surfaces leave-vs-drop natively. Room signaling
delivers a snapshot envelope whose `departed` field atomically records explicit
leaves alongside the membership transition. `src/room.js` derives `left` when
that transition records the member and `dropped` when a member disappears
without such metadata.

Requests:

1. Add `reason: 'left' | 'dropped'` to `memberLeft` and `alone`, derived from
   the atomic snapshot transition.
2. Separately, consider an optional `presenceRecovery: { graceMs }` room
   policy: for `dropped` peers, delay `alone`/teardown for the window and emit
   presence-specific recovery events.

This would let us delete an app-side data-channel `bye` workaround we built for
exactly this — and it's more reliable, since a signaling `leave` survives even
when the data channel is already dead. Backend note: the signaling snapshot
produced by the Durable Object's `broadcastPeers` must carry explicit departure
metadata atomically.
