# Web Components V1 Roadmap

Tracking the remaining gaps before `@kidlib/p2p/components` should be
considered production-ready. Items are ordered by impact on real consumers.

## 1. Styling is locked inside shadow DOM

No `::part`, no exposed CSS custom properties, no slots for caption/message
templates. The default styles are reasonable for a demo but force consumers
to either accept the look or rewrite the component. This is the biggest
practical adoption blocker.

**Direction:** add `part` attributes to every styleable element (`messages`,
`message`, `input`, `send-button`, `video`, `caption`, ...), document a small
set of CSS custom properties (`--p2p-accent`, `--p2p-border`, `--p2p-radius`),
and replace the message/caption renderers with `<slot>`-based templates so
apps can fully override markup.

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

## 4. `disconnectedCallback` calls `leave()` unconditionally

Any framework that reparents the node (React strict mode, conditional render,
portals, view transitions) tears the room down. Common custom-element gotcha
but real.

**Direction:** defer the `leave()` to the next microtask and cancel it if
`connectedCallback` re-fires before it runs. Document the behavior and
escape hatch.

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

## 7. Every data-channel message gets JSON.parse'd

`P2PRoomElement.onDataChannelMessage` parses every payload looking for the
chat type. Apps with their own binary or large-message protocols pay the
cost on every frame.

**Direction:** opt-in chat: only attach the chat parser when a
`<p2p-chat>` element is mounted inside the room (or when the consumer calls
`room.sendChat`). Track mount/unmount via the existing subscriber set.

## 8. Framework type augmentation gaps

Only Solid currently has JSX typing (`components.solid.d.ts`). React, Vue,
and others get red squiggles.

**Direction:** add `components.react.d.ts`, `components.vue.d.ts` etc. as
needed, each with its own subpath export. Keep them strictly type-only —
the runtime stays framework-agnostic.

## 9. No stable peer identity setter

`peerId` is minted in the constructor. Apps cannot pass in a stable
identity tied to a user account, signal, or store.

**Direction:** allow `element.peerId = '...'` before `join()` and a
`peer-id` attribute. Re-minting on every leave/rejoin should be opt-in,
not the default.

## 10. Accessibility is minimal

Form has `aria-label`s but no visible labels. Errors are rendered to the
DOM but not announced. Video tiles have captions but no live status when
a remote leaves. Keyboard interaction on video tiles is undefined.

**Direction:** add visible labels (or proper `<label>` elements) in the
controls, `role="alert"` / `aria-live="assertive"` on error region, and
keyboard focus styles on video tiles. WCAG audit before V1 cut.

## Quick wins

These are small, isolated, and purely beneficial — knock them out
opportunistically rather than as a batch.

- **Chat `max-messages` attribute.** Replace the hardcoded
  `CHAT_HISTORY_LIMIT = 50` with an attribute-driven cap. ~5 lines.
- **`peer-id` attribute / setter on `<p2p-room>`.** Cheap, unlocks
  stable identities in apps that already have one.
- **`<p2p-chat>` opt-in JSON.parse.** Skip parsing when no chat element
  is mounted. Same module, no API change.
- **Defer-and-cancel in `disconnectedCallback`.** Five-line guard that
  fixes the React-strict-mode foot-gun.
- **Expose CSS custom properties for the existing palette** (`--p2p-accent`,
  `--p2p-border`, `--p2p-radius`, `--p2p-bg`). Doesn't unlock full theming
  but covers 80% of the brand-color use case.
- **`part` attributes on the obvious targets** (message list, send button,
  video figure). Pairs with the above; consumers can style the rest later.
- **`role="alert"` on the status error region.** One attribute, real a11y
  improvement.
- **Drop the unused `escapeHtml` import path** — already done as part of
  the chat textContent refactor; flagged here only as a reminder that
  similar dead-code passes are cheap.
