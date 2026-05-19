# SolidJS Compatibility Considerations

This document covers the SolidJS wrapper components included for the web components,
and recommendations for when to use them versus `@kidlib/p2p/solid`.

## What's already in place

- **Wrapper Components**: Capitalized JSX components (`P2PRoom`, `P2PRoomControls`, `P2PVideoGrid`, etc.) from `@kidlib/p2p/components/solid`.
- **Automatic Registration**: The wrappers safely check for `customElements` and call `defineP2PComponents()` automatically. This prevents SSR crashes.
- **Prop Wrapping**: The wrappers handle forwarding object-shaped configuration (`createSignaling`, `getLocalStream`, `roomOptions`) under the hood so you don't need to manually prefix them with the `prop:` namespace.

## Idiomatic usage notes

### Use the wrapper components

Instead of using raw lowercase tags (`<p2p-room>`), use the exported Solid wrappers:

```tsx
import { P2PRoom, P2PVideoGrid } from '@kidlib/p2p/components/solid';

<P2PRoom
  roomId='demo'
  createSignaling={({ roomId }) => createRoomSignalingForApp(roomId)}
>
  <P2PVideoGrid />
</P2PRoom>;
```

### Reach inside with `ref`

Imperative access (call `join()` on mount, expose `room`, etc.) works just by passing a ref to the wrapper:

```tsx
let room!: P2PRoomElement;
return <P2PRoom ref={room} roomId='demo' />;
```

### Two paths to a room: wrapper components vs. `useP2PRoom`

The package exposes two parallel surfaces to Solid users:

| Use case                                | Prefer                                |
| --------------------------------------- | ------------------------------------- |
| Drop-in UI, minimal code                | Wrapper components (`P2PRoom` etc.)   |
| Custom UI with Solid signals everywhere | `useP2PRoom` from `@kidlib/p2p/solid` |

The web components own their DOM (shadow root) and their state.
`useP2PRoom` returns fine-grained accessors (`localStream`,
`remoteStreams`, `state`, ...) that compose with `<For>`, `<Show>`,
stores, and resources. **Mixing is fine** — use `<P2PVideoGrid>` and
`<P2PChat>` while rendering your own Solid UI for the rest, via the `onRoomChange` prop.

Caveat: web components subscribe internally; their state cannot be
"lifted" into a Solid signal without forwarding through
`onRoomChange`. For apps that want to drive everything from one
store, `useP2PRoom` is the better fit.

### HMR

`defineElement` is idempotent, but live class redefinitions don't propagate to existing element instances.
Editing `web-components.js` while the dev server is running leaves
already-instantiated rooms running the old class. Refresh the page
after changes that affect the element class.

### Published JSX

`@kidlib/p2p/components/solid` currently publishes a raw `.jsx` wrapper file.
Solid apps must use tooling that runs the Solid JSX transform on that dependency
path. In Vite, use `vite-plugin-solid`; if your setup excludes dependency
transforms, explicitly include `@kidlib/p2p/components/solid`.

Before treating this API as stable, add a package build step that compiles the
wrapper to plain JavaScript and point the package export at the built file.

### Reactive children inside shadow DOM

You cannot render Solid components into `<P2PVideoGrid>`'s shadow root from outside. To customize tile rendering reactively, skip the component and write your own Solid grid driven by `useP2PRoom().remoteStreams`. The shadow parts (`tile`, `video`, `caption`) cover styling-only customization without ejecting.

## Should we adopt `solid-element`?

`solid-element` is a tool for _publishing_ Solid components as custom
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

In the meantime, `solid-element` _can_ be used by consumers in their
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
