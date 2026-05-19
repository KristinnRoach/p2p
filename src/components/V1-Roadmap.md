# Web Components V1 Roadmap

Tracking the remaining gaps before `@kidlib/p2p/components` should be
considered production-ready. Items are ordered by impact on real consumers.

## 1. Styling extensibility is incomplete

Done: `part` attributes and CSS custom properties are exposed for the shipped
controls, status, video grid, and chat surfaces. Remaining: no slots for
caption/message templates. The default markup is reasonable for a demo but
still forces consumers to accept the rendered structure or rewrite the
component.

**Direction:** document the exposed parts and CSS custom properties, then
replace the message/caption renderers with `<slot>`-based templates so apps
can fully override markup.

## 2. Global singleton config (`componentDefaults`)

`configureP2PComponents()` mutates module-level state. Multi-room apps, tests
running in parallel, and SSR setups all share one global, which is a footgun.

**Direction:** keep the global as a convenience, but make per-tree config
first-class — e.g. a `<p2p-config>` ancestor element or
`element.createSignaling = ...` (already supported on `<p2p-room>`) as the
recommended path. Document the precedence.

## 3. Shadow-boundary lookup in `findRoomElement`

`element.closest('p2p-room')` cannot cross shadow roots. Any consumer that
wraps `<p2p-chat>` inside their own component's shadow root gets a thrown
error.

**Direction:** support an explicit `room` property/attribute on child
elements that takes either an element reference or a selector, and fall back
to ascending through `getRootNode().host` chains before throwing.

## 4. Disconnect behavior needs documentation and escape hatch

Done: `disconnectedCallback` defers `leave()` to the next microtask and cancels
it if the room reconnects first. Remaining: document the behavior and provide
an explicit escape hatch for consumers that need different teardown semantics.

**Direction:** keep the defer-and-cancel default, document how framework
reparenting is handled, and add the escape hatch.

## 5. Chat ephemeral, no hydrate hook, 50-message cap hardcoded

`p2p-chat` starts empty on every join. There's no way to seed from app
storage or to change the in-memory cap. The current limit is a constant.

**Direction:** expose `chat.history` property with get/set semantics, a
`max-messages` attribute, and a `p2p-chat-message` event payload stable
enough for apps to persist. Out-of-scope: actual storage — that's the app's
job.

## 6. No media controls

Cannot mute the mic, disable the camera, or switch input device from the UI
the package ships. For an "out of the box" widget this is the most visible
gap from a user's perspective.

**Direction:** add a `<p2p-media-controls>` element with mic/camera toggles
and a device picker. Keep it optional — `<p2p-video-grid>` should keep
working without it.

## 7. Chat parsing is opt-in but send-only usage is unresolved

Done: `<p2p-chat>` mount/unmount enables and disables the chat parser, and
data-channel messages skip `JSON.parse` while the chat-listener count is zero.
Remaining: clarify or implement the parser behavior for consumers that call
`room.sendChat` without mounting `<p2p-chat>`.

**Direction:** keep parser activation tied to `<p2p-chat>` mount/unmount, then
decide whether `room.sendChat` should also opt the room into receiving chat
messages or whether send-only chat is intentionally unsupported.

## 8. Framework type augmentation gaps

Only Solid currently has JSX typing (`src/components/solid/index.d.ts`).
React, Vue, and others get red squiggles.

**Direction:** add `components.react.d.ts`, `components.vue.d.ts` etc. as
needed, each with its own subpath export. Keep them strictly type-only —
the runtime stays framework-agnostic.

## 9. Stable peer identity needs final docs

Done: apps can set `element.peerId = '...'` before `join()` or use the
`peer-id` attribute; unset rooms fall back to a per-instance generated UUID.
Remaining: document stable identity usage and the leave/rejoin behavior so
reminting is explicitly opt-in, not accidental.

**Direction:** document the `peerId` setter, `peer-id` attribute, and generated
fallback, including how consumers should intentionally choose a new identity
between sessions.

## 10. Accessibility is minimal

Form has `aria-label`s but no visible labels. Errors are rendered to the DOM and announced via `role="alert"`, but broader live-region behavior is still limited. Video tiles have captions but no live status when a remote leaves. Keyboard interaction on video tiles is undefined.

**Direction:** add visible labels (or proper `<label>` elements) in the
controls, `role="alert"` / `aria-live="assertive"` on error region, and
keyboard focus styles on video tiles. WCAG audit before V1 cut.

## Quick wins

Small, isolated, purely beneficial. Status reflects current branch.

- [x] **Chat `max-messages` attribute.** Replaces hardcoded
      `CHAT_HISTORY_LIMIT`. Re-trims on attribute change.
- [x] **`peer-id` attribute / setter on `<p2p-room>`.** Falls back to a
      per-instance generated UUID when unset.
- [x] **`<p2p-chat>` opt-in JSON.parse.** Room tracks a chat-listener
      counter via `enableChatParsing` / `disableChatParsing`; data-channel
      messages skip parsing when the counter is zero.
- [x] **Defer-and-cancel in `disconnectedCallback`.** `queueMicrotask`
      with an `isConnected` recheck so reparenting doesn't tear the room
      down. Remaining: documentation and an explicit escape hatch.
- [x] **CSS custom properties** (`--p2p-accent`, `--p2p-accent-fg`,
      `--p2p-border`, `--p2p-radius`, `--p2p-bg`, `--p2p-fg`,
      `--p2p-muted-fg`, `--p2p-error`) on every component's `:host`.
- [x] **`part` attributes** on controls (`form`, `room-id-input`,
      `join-button`, `leave-button`), status (`status`, `members`,
      `error`), video grid (`grid`, `empty`, `tile`, `video`, `caption`),
      and chat (`messages`, `message`, `form`, `input`, `send-button`).
- [x] **`role="alert"`** on the status error region.
