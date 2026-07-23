# TURN, ICE recovery, and room departure semantics: design questions

Status: ICE recovery, TURN credentials, and presence recovery remain discovery
only; no implementation decisions for those features are final. Section F
records the resolved departure-reason slice and is no longer provisional.

## Findings that shape the questions

- `Peer` currently observes `RTCPeerConnection.connectionState`, but does not
  perform renegotiation.
- The joiner intentionally handles only the first offer. An ICE restart needs a
  new offer/answer exchange, so recovery requires changing the negotiation
  lifecycle rather than merely calling `restartIce()`.
- The WebRTC specification recommends an ICE restart when
  `iceConnectionState` becomes `failed`. It describes `disconnected` as a
  transient state that may recover without intervention, so a grace period is
  appropriate.
- If both endpoints may independently create restart offers, offer glare must
  be handled. The W3C-recommended general solution is perfect negotiation
  (polite/impolite roles and rollback).
- Cloudflare documents refreshing short-lived TURN credentials during a call
  with `RTCPeerConnection.setConfiguration()`. Cloudflare's generated browser
  payload contains `iceServers` but no expiry timestamp, so an abstraction that
  schedules refresh needs expiry information supplied separately.
- Twilio returns `ice_servers` and a TTL. Its account credentials must remain on
  the server, as must Cloudflare's TURN key/token.
- `P2PRoom` currently consumes complete presence snapshots. When a member is
  absent, the snapshot contains no information about why they disappeared.
  Reliable `left` versus `dropped` semantics therefore require an extended
  signaling protocol, not only a room-side comparison of consecutive arrays.
- Room presence recovery and ICE transport recovery are separate state
  machines. A member can remain present while ICE is recovering, or disappear
  from presence while an existing peer connection is temporarily still usable.

Current references:

- [W3C WebRTC Recommendation](https://www.w3.org/TR/webrtc/)
- [MDN `RTCPeerConnection.restartIce()`](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/restartIce)
- [Cloudflare Realtime TURN credential generation](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
- [Twilio Network Traversal Service](https://www.twilio.com/docs/stun-turn)

## A. Scope and compatibility

1. Should ICE recovery be available consistently through all three layers:
   `Peer`, `P2PSession`, and every pair owned by `P2PRoom`?
   **Recommendation:** yes.

2. Should ephemeral ICE-server credentials likewise work at all three layers?
   **Recommendation:** yes, with room-level caching so a room does not fetch
   credentials independently for every pair.

3. Must all existing options, event names, signaling adapters, and STUN-only
   behavior remain backward compatible when the new features are not enabled?
   **Recommendation:** yes; both recovery systems should be opt-in.

4. Is this intended as one release containing ICE recovery, credential refresh,
   departure reasons, and room presence grace, or should it be split into
   independently reviewable changes?
   **Recommendation:** split the implementation into coherent commits or PRs,
   while agreeing on the combined API first.

5. Should the work include a minor-version changeset?
   **Recommendation:** yes.

## B. ICE restart authority and renegotiation

6. May the original `initiator` be the sole endpoint allowed to create ICE
   restart offers?
   **Recommendation:** yes. This fits the library's current asymmetric
   offer/answer model and avoids introducing full perfect negotiation.

7. If only the joiner detects a failed connection and no restart offer arrives,
   should it merely report recovery failure, or must it eventually become an
   offerer?
   **Recommendation:** report/wait under the sole-offerer model. Requiring the
   joiner to take over implies glare resolution and a broader negotiation
   redesign.

8. Is HangVidU's pair signaling guaranteed to remain connected and bidirectional
   throughout a media network-path change?

9. Can a signaling reconnect replay old offers, answers, or candidates, and
   does each message carry any generation, sequence, or call identifier?

10. Do you expect future features such as adding/removing transceivers to allow
    either endpoint to initiate renegotiation?
    **Recommendation:** if yes, implement perfect negotiation now; if no, keep
    the narrower sole-offerer design.

11. If perfect negotiation is selected, which existing role should be polite?
    **Recommendation:** make the joiner polite and the initiator impolite, so
    the initial call flow remains intuitive.

12. Should a consumer be able to request an ICE restart manually?
    **Recommendation:** expose async `restartIce()` methods on `Peer` and
    `P2PSession`, using the same serialization, credential refresh, events, and
    error handling as automatic recovery.
    **Deferred:** do not expose this method until restart authority is decided.
    Under the current sole-initiator proposal, joiner calls must either reject
    clearly or signal the initiator to restart; silently doing nothing is not an
    acceptable API.

13. Should frozen-media detection via `getStats()` remain outside this feature?
    **Recommendation:** yes. It is useful when media stalls while ICE still says
    `connected`, but deserves a separate policy and test surface.

## C. ICE failure triggers, retry policy, and terminal behavior

14. Should `iceConnectionState === 'failed'` be the authoritative immediate
    restart trigger, rather than every `connectionState === 'failed'`?
    **Recommendation:** yes. `connectionState` can also represent DTLS failure,
    which an ICE restart may not repair.

15. Should `connectionState` still be observed and included in diagnostics and
    events?
    **Recommendation:** yes.

16. How long should a transient `disconnected` state be allowed to self-heal
    before restarting ICE?
    **Recommendation:** `disconnectedGraceMs: 3000`.

17. Should returning to `connected` during that grace period cancel the pending
    restart without consuming an attempt?
    **Recommendation:** yes.

18. Should the public option use one ambiguous `timeoutMs`, or distinguish the
    disconnected grace period from the timeout for an in-flight attempt?
    **Recommendation:** distinguish `disconnectedGraceMs` and
    `attemptTimeoutMs`.

19. Are these acceptable initial defaults?

    ```js
    // Disabled by default: omit iceRecovery or set it to false.
    // Providing the object opts in.
    iceRecovery: {
      maxAttempts: 3,
      disconnectedGraceMs: 3000,
      attemptTimeoutMs: 10000,
      backoffMs: attempt => Math.min(1000 * 2 ** (attempt - 1), 8000),
    }
    ```

    **Recommendation:** use
    `iceRecovery?: false | IceRecoveryOptions`, defaulting to `false`.
    Supplying an options object enables recovery; do not add a redundant
    `enabled` field.

20. Should configuration use serializable numeric backoff options instead of a
    callback?
    **Recommendation:** use `initialBackoffMs`, `backoffFactor`, and
    `maxBackoffMs`; it is easier to type, document, clone, and pass through
    component APIs.

21. Does `maxAttempts` include the first immediate restart?
    **Recommendation:** yes.

22. When should the attempt counter reset?
    **Recommendation:** after the connection has remained connected for a short
    stability window, rather than immediately during a flap. What should that
    window be?

23. Should a fresh `failed` event during an in-flight restart be coalesced into
    the current attempt?
    **Recommendation:** yes; only one offer/answer operation may run at once.

24. What should happen after all attempts are exhausted?
    **Recommendation:** keep the peer connection open, set the library state to
    `failed`, emit a terminal recovery event, and let the consumer decide
    whether to close or redial.

25. Should a later manual restart be allowed after automatic attempts are
    exhausted?
    **Recommendation:** yes.

26. Should calling `close()`, leaving a room, or aborting startup cancel every
    pending grace timer, retry timer, credential request, and renegotiation
    callback?
    **Recommendation:** yes.

## D. ICE recovery API and events

27. To avoid collision with room-presence recovery, should the option be named
    `iceRecovery` rather than a generic `reconnect`?
    **Recommendation:** yes.

28. Is this event model acceptable?

    ```js
    peer.on('iceReconnecting', ({
      attempt,
      maxAttempts,
      reason,
      nextDelayMs,
    }) => {});

    peer.on('iceReconnected', ({ attempt, durationMs }) => {});

    peer.on('iceReconnectFailed', ({
      attempts,
      reason,
      error,
    }) => {});
    ```

29. Do you prefer the requested generic names `reconnecting`, `reconnected`,
    and `reconnectFailed` instead?
    **Recommendation:** reserve generic names only if every event has a
    mandatory `scope: 'ice' | 'presence'`; otherwise explicit names prevent UI
    and telemetry ambiguity.

30. Should `connected` fire again after successful recovery?
    **Recommendation:** no. Preserve it as the initial-connection event and use
    `iceReconnected` for subsequent recoveries.

31. Should the existing `disconnected` event fire immediately on a transient
    disconnect, even when automatic recovery is enabled?
    **Recommendation:** yes, with richer detail describing whether recovery is
    scheduled.

32. Should room-forwarded ICE events include both `memberId` and `peerId` while
    the deprecated peer-named API remains supported?
    **Recommendation:** yes.

33. Should ICE recovery change the public `PeerState` union, for example by
    adding `reconnecting`, or should recovery be represented only by events?
    **Recommendation:** keep connection state and recovery activity separate;
    do not add another peer state unless consumers explicitly need it.

## E. Ephemeral TURN credential contract

34. Should `rtcConfig` remain a valid native `RTCConfiguration`, with a separate
    async provider option?
    **Recommendation:** yes:

    ```js
    {
      rtcConfig,
      iceServersProvider: async ({ reason, signal }) => ({
        iceServers,
        expiresAt,
      }),
    }
    ```

35. Should the provider return only `iceServers`, rather than an entire
    `RTCConfiguration`?
    **Recommendation:** yes. This prevents a credential refresh from replacing
    stable settings such as `iceTransportPolicy`, `bundlePolicy`, or
    certificates.

36. Is epoch-millisecond `expiresAt` acceptable as the canonical expiry field?
    **Recommendation:** yes. Provider-specific adapters can convert Cloudflare
    request TTLs and Twilio response TTLs to it.

37. Should a result without `expiresAt` be supported?
    **Recommendation:** yes as non-refreshable credentials, but document that
    scheduled refresh and expiry-aware recovery require `expiresAt`.

38. Should credentials be fetched before constructing
    `RTCPeerConnection`?
    **Recommendation:** yes.

39. Should fetching occur in `Peer.start()` rather than the constructor so the
    constructor remains synchronous?
    **Recommendation:** yes.

40. Should fresh credentials be fetched proactively and applied with
    `pc.setConfiguration()` before expiry?
    **Recommendation:** yes.

41. Should merely refreshing credentials trigger an ICE restart?
    **Recommendation:** no. Apply the configuration, then use it on the next
    needed restart; avoid unnecessary media disruption.

42. Before every ICE restart, should the library ensure the cached credentials
    are still outside their refresh margin?
    **Recommendation:** yes.

43. What refresh margin should be used?
    **Recommendation:** the smaller of 60 seconds or 10% of the credential
    lifetime, with a `refreshMarginMs` override.

44. Should concurrent peers or recovery attempts share one in-flight provider
    request?
    **Recommendation:** yes.

45. In a room, should the cache and refresh timer be owned by `P2PRoom`, with
    all current peer connections receiving the refreshed configuration?
    **Recommendation:** yes.

46. Can different room members ever require different TURN credentials?
    If yes, what input should the provider receive to choose credentials?

47. What should happen when a proactive refresh fails while current credentials
    have not expired?
    **Recommendation:** emit an `error` with phase
    `ice-servers-refresh`, keep the current configuration, and retry with
    bounded backoff.

48. What should happen when credentials are expired and a recovery attempt
    cannot refresh them?
    **Recommendation:** fail that recovery attempt explicitly; never silently
    fall back to the package's public STUN server.

49. Should the provider receive an `AbortSignal` and a reason such as
    `initial`, `scheduled-refresh`, `ice-restart`, or `manual`?
    **Recommendation:** yes.

50. Should the library include generic caching/refresh helpers but no
    Cloudflare or Twilio SDK dependency?
    **Recommendation:** yes.

51. Should documentation include small backend and browser examples for both
    Cloudflare and Twilio response normalization?
    **Recommendation:** yes, while making it explicit that long-lived provider
    secrets never belong in browser code.

52. Should the default STUN-only limitation be called out in the README, peer
    docs, room docs, and config export documentation?
    **Recommendation:** yes. State plainly that symmetric NATs and restrictive
    mobile/firewall networks generally require TURN.

## F. Durable `left` versus `dropped` signaling semantics

**Resolved for the first slice:** see
`FEATURE_SLICE_LEFT_VS_DROPPED_SIGNAL.md`. The envelope carries only explicit
`left` departures; every unmarked disappearance is `dropped`. Generation IDs,
durable retention, moderation reasons, and presence grace remain out of scope.
Page lifecycle events are unmarked drops; core does not call `leave()` on
`pagehide`.

53. Which backend events definitively mean `left`?
    **Resolved for this slice:** explicit UI hangup, `room.leave()`, and
    `room.close()`. Page lifecycle events are not explicit leaves. Server kick
    and room shutdown remain future decisions.

54. Which backend events definitively mean `dropped`?
    **Resolved for this slice:** page lifecycle loss, heartbeat TTL expiry, and
    unclean socket close. Durable Object restart and stale-session replacement
    remain backend-specific.

55. Do administrative removal and rejection need a third reason such as
    `removed`, or must the public API remain exactly `'left' | 'dropped'`?
    **Recommendation:** decide now; collapsing moderation into `left` may later
    become misleading.

56. Does the Durable Object receive and persist an explicit leave before it
    removes the member and broadcasts the new membership?

57. How long is departure metadata retained, and can a subscriber reconnecting
    after the departure still retrieve the reason?

58. Can `broadcastPeers` broadcasts be lost, duplicated, or received out of
    order during socket reconnection?

59. Does each membership incarnation have a generation/session ID distinct
    from `memberId`?
    **Recommendation:** add one if a member can quickly leave and rejoin with
    the same ID. Without it, a delayed departure can be applied to the new
    incarnation.

60. Should the room signaling contract change from a bare snapshot to an
    envelope such as:

    ```ts
    interface P2PRoomPresenceSnapshot {
      members: P2PRoomPresenceMember[];
      departures?: Array<{
        memberId: string;
        reason: 'left' | 'dropped';
        generation?: string;
      }>;
    }
    ```

    **Recommendation:** yes, while continuing to accept legacy `string[]` and
    `{ memberId, data }[]` snapshots.

61. Would a separate ordered `onDeparture(callback)` signaling method fit the
    Durable Object protocol better than departure metadata in snapshots?
    **Recommendation:** prefer a snapshot envelope with recent departure
    metadata if reconnecting subscribers must recover missed events; a purely
    live callback is not durable.

62. If legacy adapters provide no departure metadata, what reason should the
    room emit?
    **Recommendation:** `dropped`, because no explicit leave was observed. Is
    that acceptable, or should the type include `unknown` during migration?

63. Must every updated adapter broadcast the departure reason atomically with
    the snapshot in which the member first disappears?
    **Recommendation:** yes.

64. If the same disappearance is reported repeatedly, should the room de-duplicate
    it by member generation/departure ID?
    **Recommendation:** yes.

65. Should reason metadata also be added to deprecated `peerLeft` events?
    **Recommendation:** yes for consistency.

66. Should `membersChanged` expose recent departures, or remain a pure current
    membership snapshot?
    **Recommendation:** keep it pure and put departure semantics on
    `memberLeft`/`peerLeft`.

## G. Room presence grace and teardown

67. To distinguish it from ICE recovery, should the room option be called
    `presenceRecovery`?
    **Recommendation:**

    ```js
    presenceRecovery: {
      graceMs: 15000,
    }
    ```

68. Should presence grace apply only to `dropped`, with `left` always causing
    immediate `memberLeft`, pair teardown, and `alone`?
    **Recommendation:** yes.

69. During a dropped member's grace window, should the existing
    `P2PSession`, media stream, and data channel be retained?
    **Recommendation:** yes; otherwise the feature delays only UI events and
    cannot preserve a self-healing connection.

70. Should a dropped member remain in `room.members`, `memberPresence`, and
    `memberCount` during grace?
    **Recommendation:** no for authoritative presence, but this creates a
    visible distinction between membership and retained connections. Is that
    acceptable?

71. If dropped members are removed immediately from `members`, should a
    separate `recoveringMembers` collection be exposed?
    **Recommendation:** yes if consumers need to render presence separately
    from media sessions.

72. Should capacity calculations count a dropped member during its grace
    period?
    **Recommendation:** no; backend presence should remain authoritative for
    room capacity.

73. Should `memberLeft` be delayed until grace expires for a dropped member?
    **Recommendation:** yes. Emit a recovery-start event immediately, then
    either a recovered event or `memberLeft({ reason: 'dropped' })`.

74. Should `memberStreamRemoved` and `dataChannelClose` likewise be delayed
    until actual teardown?
    **Recommendation:** yes.

75. If the last remote member drops, should `alone` and
    `autoCloseWhenAlone` both wait until grace expires?
    **Recommendation:** yes.

76. What should `alone.reason` mean if several members disappear for different
    reasons in a short interval?
    **Recommendation:** use the reason of the departure that caused the room to
    become effectively alone, and consider also including a `departures`
    collection. Is a single reason sufficient for your 1:1 HangVidU use case?

77. Should `alone` contain `reason` only after a prior member existed, as it
    does today, and never fire merely because a room starts empty?
    **Recommendation:** yes.

78. If a member reappears within grace with the same generation/session ID,
    should the existing pair be retained and a presence-recovered event emitted?
    **Recommendation:** yes.

79. If the same `memberId` reappears with a new generation/session ID, should
    the old pair be torn down and a fresh pair created even within grace?
    **Recommendation:** yes; this prevents stale signaling and media from being
    attached to a new browser/session incarnation.

80. If no generation ID exists, should same-ID reappearance retain the old
    pair or rebuild it?
    **Recommendation:** rebuild for correctness, though this sacrifices seamless
    recovery. This is a reason to add a generation ID.

81. If presence returns but the retained peer connection is still
    disconnected, should the presence-recovered event wait for ICE recovery?
    **Recommendation:** no. Emit presence recovery when signaling presence
    returns; ICE recovery has separate events and may complete later.

82. Should a later explicit `left` arriving during an active dropped grace
    window cancel the grace and tear down immediately?
    **Recommendation:** yes.

83. Should another dropped event extend/restart the grace window?
    **Recommendation:** no for the same generation; bound the total wait from
    the first disappearance.

84. Should `graceMs: 0` preserve immediate teardown while still supplying
    departure reasons?
    **Recommendation:** yes.

85. What default should be documented for opt-in room presence recovery?
    **Recommendation:** 15 seconds, but it should be coordinated with the
    backend heartbeat/TTL timings. What are HangVidU's heartbeat interval and
    Durable Object expiry/disconnect timings?

86. Is a presence-drop grace still useful after the backend has already waited
    through a heartbeat TTL before declaring the member dropped, or would that
    produce an unacceptably long combined delay?

87. Should presence recovery be enabled independently of ICE recovery?
    **Recommendation:** yes, with examples showing how to enable either or both.

## H. Room recovery events and consumer migration

88. Is this explicit event naming acceptable?

    ```js
    room.on('memberReconnecting', ({
      memberId,
      reason: 'dropped',
      graceMs,
    }) => {});

    room.on('memberReconnected', ({
      memberId,
      reason: 'dropped',
      durationMs,
    }) => {});

    room.on('memberReconnectFailed', ({
      memberId,
      reason: 'dropped',
      durationMs,
    }) => {});
    ```

89. Should the requested generic room events instead be used with a mandatory
    `scope: 'presence'`?

90. Does `memberReconnectFailed` fire immediately before
    `memberLeft({ reason: 'dropped' })`, or is it redundant?
    **Recommendation:** fire both: one describes recovery outcome, the other
    describes final membership transition.

91. Should deprecated peer-named aliases (`peerReconnecting`,
    `peerReconnected`, and `peerReconnectFailed`) be added?
    **Recommendation:** no new deprecated aliases unless HangVidU still consumes
    the peer-named API.

92. Does HangVidU need a callback option for each new event in
    `P2PRoomOptions`, or is `.on(...)` sufficient?
    **Recommendation:** match the existing room event ergonomics and offer both
    where the library currently does so.

93. Once native departure reasons ship, may documentation explicitly recommend
    deleting the data-channel `bye` workaround?
    **Recommendation:** yes, after the Durable Object adapter is upgraded and
    deployment ordering is documented.

94. Must the library tolerate a mixed deployment where some backend instances
    emit reason-aware envelopes and others still emit legacy snapshots?
    **Recommendation:** yes.

95. In a mixed deployment, is treating legacy disappearance as `dropped`
    acceptable, or does HangVidU need to keep its `bye` fallback temporarily?

## I. Testing, diagnostics, and rollout

96. Which browsers and minimum versions are supported by `@kidlib/p2p`?

97. Should browser tests cover an actual second offer/answer exchange and ICE
    credential change, in addition to mocked state/timer tests?
    **Recommendation:** yes.

98. Can the Durable Object signaling backend or its protocol fixtures be
    included in this repository's tests, or will its changes be made and tested
    in HangVidU?

99. Should departure tests cover explicit leave, socket loss, TTL expiry,
    duplicate broadcasts, out-of-order broadcasts, missed broadcasts,
    same-ID/same-generation return, and same-ID/new-generation return?
    **Recommendation:** yes.

100. Should fake timers be used for retry, credential expiry, and presence-grace
     tests, with browser integration tests reserved for negotiation behavior?
     **Recommendation:** yes.

101. What telemetry does HangVidU need from each recovery attempt: selected
     candidate type, relay usage, elapsed time, signaling state, ICE state,
     connection state, or provider-refresh outcome?

102. Should errors continue through the existing `error` event with structured
     `phase` values, while lifecycle outcomes use dedicated events?
     **Recommendation:** yes.

103. Should documentation include a rollout order?
     **Recommendation:** deploy reason-aware Durable Object signaling first,
     then the backward-compatible library, then migrate HangVidU and remove the
     `bye` workaround last.
