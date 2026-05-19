# ChatExample Reviewer Handoff

Read `README.md` for the integration contract and `USAGE.md` for low-level hook usage.

Important review points:

- `ChatRoom` requires only `messageTransport`; `privateChat` and `callChannel` are optional extensions.
- `ChatRoom` creates per-instance state internally. Lower-level hook consumers should create their own `createChatState()` and `createChatActions()`.
- `demo.adapters.ts` and `use-call-manager.ts` are demo-only.
- Lifecycle coverage lives in `tests/chat-example-private-lifecycle.browser.test.js`; focus review on persisted-only setup, optional private request cancel/accept, stale loads, cleanup, and missing private routes.
