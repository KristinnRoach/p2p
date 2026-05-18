# SolidJS Compatibility Considerations

This document covers what already works, what to do for idiomatic Solid
usage, and decisions worth taking before recommending the components to
Solid users at scale.

## What's already in place

- **Subpath export** `@kidlib/p2p/components/solid` re-exports the
  runtime `defineP2P*` and the element classes, and pulls in JSX module
  augmentation in one import.
- **JSX type augmentation** for `p2p-room`, `p2p-room-controls`,
  `p2p-room-status`, `p2p-video-grid`, `p2p-chat`, including:
  - Attribute typing (`room-id`, `member-capacity`, `peer-id`,
    `max-messages`).
  - `prop:` namespace for object-shaped configuration (`createSignaling`,
    `getLocalStream`, `roomOptions`).
  - `on:p2p-room-change` and `on:p2p-chat-message` typed against
    `CustomEvent<P2PRoomSnapshot>` / `CustomEvent<P2PChatMessage>`.

## Idiomatic usage notes

### Pass object configuration with `prop:`

Solid coerces unprefixed attribute values to strings. The three
object-shaped options must use the `prop:` namespace or a `ref`:

```tsx
<p2p-room
  room-id="demo"
  prop:createSignaling={({ roomId }) => createRoomSignalingForApp(roomId)}
  prop:roomOptions={{ rtcConfig: { iceServers: [...] } }}
/>
```

Without `prop:`, you'll see `"[object Object]"` as the attribute value
and `createSignaling` will end up as a string.

### Listen with the `on:` namespace

Native Solid event binding for custom events:

```tsx
<p2p-room on:p2p-room-change={(e) => setSnapshot(e.detail)} />
```

The augmentation types `e.currentTarget` as `P2PRoomElement`, so
`e.currentTarget.sendChat(...)` is type-safe.

### Reach inside with `ref`

Imperative access (call `join()` on mount, expose `room`, etc.):

```tsx
let room!: P2PRoomElement;
return <p2p-room ref={room} room-id="demo" />;
```

`room.subscribe((snap) => ...)` returns an unsubscribe; pair it with
`onCleanup`.

### Two paths to a room: web components vs. `useP2PRoom`

The package now exposes two parallel surfaces to Solid users:

| Use case                                | Prefer                                |
|-----------------------------------------|---------------------------------------|
| Drop-in UI, minimal code                | Web components                        |
| Custom UI with Solid signals everywhere | `useP2PRoom` from `@kidlib/p2p/solid` |

The web components own their DOM (shadow root) and their state.
`useP2PRoom` returns fine-grained accessors (`localStream`,
`remoteStreams`, `state`, ...) that compose with `<For>`, `<Show>`,
stores, and resources. **Mixing is fine** — use `<p2p-video-grid>` and
`<p2p-chat>` for the standard bits while rendering your own Solid UI
for the rest, via `p2p-room-change` subscription.

Caveat: web components subscribe internally; their state cannot be
"lifted" into a Solid signal without forwarding through
`on:p2p-room-change`. For apps that want to drive everything from one
store, `useP2PRoom` is the better fit.

### Cleanup in SSR / SolidStart

`customElements.define` only exists in the browser. If you call
`defineP2PComponents` at module top-level it'll throw during SSR. Two
options:

```tsx
import { onMount } from 'solid-js';
import { isServer } from 'solid-js/web';

onMount(() => {
  if (isServer) return;
  defineP2PComponents({ createSignaling: ... });
});
```

Or guard at import time with a dynamic `import('@kidlib/p2p/components/solid')`
inside an `onMount`. The custom elements will not hydrate on the server
in any case (they have no SSR representation today), so render them
inside a `<Show when={mounted()}>` gate or accept a flash.

### HMR

`defineElement` is idempotent (`customElements.get` guard), but live
class redefinitions don't propagate to existing element instances.
Editing `web-components.js` while the dev server is running leaves
already-instantiated rooms running the old class. Refresh the page
after changes that affect the element class.

### Reactive children inside shadow DOM

You cannot render Solid components into `<p2p-video-grid>`'s shadow
root from outside. To customize tile rendering reactively, skip the
component and write your own Solid grid driven by
`useP2PRoom().remoteStreams`. The shadow parts (`tile`, `video`,
`caption`) cover styling-only customization without ejecting.

## Should we adopt `solid-element`?

`solid-element` is a tool for *publishing* Solid components as custom
elements. For the consumer ergonomics this doc is about, it would only
matter if we rewrote the existing class-based components in Solid and
re-shipped them through `solid-element`. Evaluation:

**Pros**

- Fine-grained reactive props on custom elements via `createSignal`.
- Less boilerplate for the components themselves (`<For>` over remote
  streams instead of manual figure diffing).
- Single mental model with the rest of `@kidlib/p2p/solid`.

**Cons**

- Adds a hard `solid-js` runtime dependency to `@kidlib/p2p/components`.
  Today `solid-js` is a strictly optional peer; consumers using only
  the components in vanilla / React / Vue would start paying for Solid.
- The components would become Solid-authored elements rendered into
  shadow DOM with Solid's reactivity. That works, but a vanilla
  consumer reading the source no longer recognizes it as plain web
  components — bus-factor cost.
- We'd need a separate non-Solid build (web-components.js stays) or a
  conditional export, doubling the matrix.
- The current components are 600 LOC of plain DOM. We're not at the
  complexity threshold where Solid reactivity buys back its own weight.

**Recommendation: not now.** Revisit if any of these become true:

- We want a non-trivial set of new components (media controls, device
  picker, chat with reactions) that would noticeably benefit from
  reactivity.
- We're already shipping `solid-js` as a real dependency for some other
  reason.
- The web components grow imperative re-render logic past the point
  where it's clearly worse than a reactive rewrite.

In the meantime, `solid-element` *can* be used by consumers in their
own apps without any package change. It's compatible with the existing
components — they're just custom elements.

## Open compatibility considerations

These aren't blockers, but worth deciding before recommending the
components as the default Solid path:

- **First-class Solid wrapper components** (`<P2PRoom>`, `<P2PVideoGrid>`)
  that internally compose `useP2PRoom` and render Solid-native markup.
  Would live in `@kidlib/p2p/solid` and bypass shadow DOM entirely. The
  better long-term Solid surface — see the trade-off in the roadmap.
- **Stable identity via a Solid store/signal**. The `peer-id` attribute
  helps, but a pattern doc showing
  `<p2p-room peer-id={user().id} />` and how that reacts to login
  changes (currently it doesn't reconnect; the element only reads
  `peerId` at `join()` time).
- **`<Show>` gating around mount.** Document that the element treats
  `disconnectedCallback` as a temporary signal now (queueMicrotask
  defer), so re-rendering through `<Show>` keeps the room alive across
  flicker, but explicit `room.leave()` is still required for
  intentional teardown.
- **Hot-module replacement for `joinP2PRoom` callers**. HMR boundary
  is currently at the file level — patching the components leaves
  existing room instances unaffected. For a Solid example this is
  usually acceptable; document the workaround (page reload).
- **SolidStart hydration story**. We don't render any of this on the
  server; pin down whether we want a "skeleton" fallback element or a
  client-only gate as the recommended pattern, and document one.
- **TypeScript JSX namespace conflicts**. If a consumer already
  augments `JSX.IntrinsicElements` with `p2p-*` tags themselves, ours
  will conflict at compile time. Mitigation: keep all tags namespaced
  to `p2p-` and call it out in the migration notes.
- **Per-instance config without globals**. Apps that mount multiple
  rooms with different signaling shouldn't have to manage the
  `configureP2PComponents` singleton. The element-level setters
  (`room.createSignaling = ...`) already support this; the docs
  example should lead with that pattern in Solid contexts where
  apps frequently scope by route or session.
