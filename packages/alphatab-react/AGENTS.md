# @gpt/alphatab-react

## Purpose

A React wrapper around [AlphaTab](https://alphatab.net) — the Guitar Pro file renderer. This package is **publishable to npm** and designed for any React project that needs to render `.gp` tablatures.

It is **not** GPT-specific. It does not depend on `@gpt/gpt-core` for rendering logic (only for diff types). The GPT desktop uses it, but so could any external project.

## Public API

```tsx
import {
  AlphaTabProvider,         // context provider — wrap your app or page
  TabScore,                 // main renderer component
  useAlphaTab,              // low-level AT instance access (escape hatch)
  useScore,                 // reactive score loading state
  usePlayback,              // play/pause/stop + current beat
} from "@gpt/alphatab-react";
```

### Minimal usage

```tsx
<AlphaTabProvider>
  <TabScore src={fileBuffer} />
</AlphaTabProvider>
```

### With playback

```tsx
function Player({ buffer }: { buffer: Uint8Array }) {
  const { score } = useScore(buffer);
  const { play, pause, state } = usePlayback();
  return (
    <AlphaTabProvider>
      <TabScore src={buffer} />
      <button onClick={state === "playing" ? pause : play}>
        {state === "playing" ? "Pause" : "Play"}
      </button>
      {score && <p>{score.title}</p>}
    </AlphaTabProvider>
  );
}
```

## Source layout

```
src/
  context/
    AlphaTabContext.tsx   — React context + AlphaTabProvider
  hooks/
    useAlphaTab.ts        — creates/destroys the AT API instance
    useScore.ts           — reactive score loading
    usePlayback.ts        — playback state machine
  components/
    TabScore.tsx          — main renderer (wraps AlphaTabProvider + useAlphaTab)
    TabDiff.tsx           — diff overlay (highlights changed measures) — TODO
  index.ts               — public re-exports
```

## Peer dependencies

AlphaTab is a **peer dependency**. Consumers must install it themselves:
```bash
pnpm add @coderline/alphatab
```

This prevents version conflicts when the consumer has their own AlphaTab dependency.

## AlphaTab lifecycle

AlphaTab is not React-friendly out of the box. The lifecycle is:
1. Create `AlphaTabApi` with a DOM element and `Settings`
2. Load a score via `api.load(buffer)`
3. Listen to events: `api.scoreLoaded`, `api.error`, `api.playerStateChanged`
4. Call `api.destroy()` on cleanup

`useAlphaTab` owns this lifecycle and exposes the `api` via `AlphaTabContext`. All other hooks consume the context rather than creating their own API instances.

## Key constraints

- **One `AlphaTabProvider` per rendered score.** Do not nest providers.
- **AlphaTab requires a real DOM** (Canvas/SVG). Tests must mock the AT module — never instantiate a real `AlphaTabApi` in tests.
- **`useAlphaTab`'s `settings` option is not reactive.** It is applied once at mount. To change settings, remount the component.

## Testing

```bash
pnpm nx test @gpt/alphatab-react
```

Mock `@coderline/alphatab` entirely in tests. Use `vi.mock("@coderline/alphatab", ...)` to inject a controllable fake API.

Only test **real** components and hooks — not placeholder/skeleton files. When a component has meaningful logic (event wiring, state transitions, error handling), add a spec file next to it: `TabScore.spec.tsx`, `useScore.spec.ts`, etc.

Test naming: **`should <action> when <condition>`**
Structure: Given / When / Then inside each test.
