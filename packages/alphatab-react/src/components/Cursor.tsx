import { useState, useMemo, useRef, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAlphaTabContext } from "../context/AlphaTabContext";
import type { CursorHandler } from "../types/events";

// ─── Public types ─────────────────────────────────────────────────────────────

// beatWidth and beatContent are mutually exclusive:
//  • beatWidth  → no custom content; the container width drives the visual
//  • beatContent → you own the beat cursor entirely via React; beatWidth
//    is excluded at the type level to avoid the conflict
type BeatCursorProps =
  | {
      /** CSS/Tailwind classes applied to the beat cursor inner div. */
      beatClassName?: string;
      /**
       * Width of the beat cursor container in px (alphaTab sets this as an
       * inline style so CSS width classes are ignored). @default 2
       */
      beatWidth?: number;
      beatContent?: never;
    }
  | {
      beatClassName?: string;
      beatWidth?: never;
      /**
       * React content portaled inside the beat cursor container.
       * The container is placed at the current beat X with width=0 so your
       * content has full layout control via `position: absolute`.
       *
       * @example
       * <div className="absolute top-0 left-0 h-full w-0.5 -translate-x-1/2 bg-warning rounded-full" />
       */
      beatContent: ReactNode;
    };

export type CursorProps = {
  /**
   * Full custom ICursorHandler. Takes over all cursor rendering; all other
   * props are ignored when this is provided.
   */
  handler?: CursorHandler;

  /** CSS/Tailwind classes applied to the bar cursor inner div. */
  barClassName?: string;

  /**
   * React content portaled inside the bar cursor container.
   * The container fills the current bar bounds; use `absolute inset-0` to fill it.
   *
   * @example
   * <div className="absolute inset-0 bg-warning/15 border-l border-warning/40" />
   */
  barContent?: ReactNode;

  /**
   * CSS/Tailwind classes added to alphaTab's `.at-selection` wrapper.
   * alphaTab manages the selection children itself — we can only style the wrapper.
   */
  selectionClassName?: string;
} & BeatCursorProps;

// ─── Internal types ───────────────────────────────────────────────────────────

type Cursors   = Parameters<CursorHandler["onAttach"]>[0];
type Container = Cursors["barCursor"];
type PortalTargets = { bar: HTMLDivElement | null; beat: HTMLDivElement | null };

// ─── Helpers ──────────────────────────────────────────────────────────────────

// HtmlElementContainer.element is not in the IContainer TS interface but always
// present on the web implementation at runtime.
function domEl(c: Container): HTMLElement | undefined {
  return (c as unknown as { element?: HTMLElement }).element;
}

function addClasses(c: Container, cls: string | undefined) {
  if (!cls) return;
  const el = domEl(c);
  cls.split(/\s+/).filter(Boolean).forEach(name => el?.classList.add(name));
}
function removeClasses(c: Container, cls: string | undefined) {
  if (!cls) return;
  const el = domEl(c);
  cls.split(/\s+/).filter(Boolean).forEach(name => el?.classList.remove(name));
}

// Creates a div that fills its parent via `position: absolute; inset: 0`.
// alphaTab sizes the outer container; this div follows automatically.
function makeInner(className?: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.position = "absolute";
  el.style.top = "0";
  el.style.right = "0";
  el.style.bottom = "0";
  el.style.left = "0";
  el.style.pointerEvents = "none";
  if (className) el.className = className;
  return el;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Composable cursor — drop inside <AlphaTab.Root>.
 *
 * Unlike the alphaTab "adorner" pattern (which keeps the default cursors and
 * adds an extra element), this component *replaces* them entirely. Inner divs
 * are appended inside alphaTab's `barCursor`/`beatCursor` containers; alphaTab
 * drives their bounds and transitions while our divs fill them via `inset-0`.
 * All animation runs at 60fps with zero React state involvement.
 *
 * @example — Tailwind classes only
 * <AlphaTab.Cursor
 *   barClassName="bg-warning/15"
 *   beatClassName="bg-warning/85"
 *   beatWidth={3}
 * />
 *
 * @example — Custom React content (beatWidth is excluded when beatContent is given)
 * <AlphaTab.Cursor
 *   barContent={<div className="absolute inset-0 bg-warning/15" />}
 *   beatContent={<div className="absolute top-0 left-0 h-full w-0.5 bg-warning" />}
 * />
 */
export function Cursor(props: CursorProps) {
  const { handler, barClassName, barContent, selectionClassName } = props;
  const beatContent = "beatContent" in props ? props.beatContent : undefined;
  const beatWidth   = "beatWidth"   in props ? (props.beatWidth ?? 2) : 2;
  const beatClassName = props.beatClassName;

  const { api } = useAlphaTabContext();

  // Portal targets — updated only in onAttach/onDetach, never during playback.
  const [portals, setPortals] = useState<PortalTargets>({ bar: null, beat: null });

  // Stable ref to inner div DOM nodes shared across handler method calls.
  const innerRef = useRef<{ barEl: HTMLDivElement | null; beatEl: HTMLDivElement | null }>(
    { barEl: null, beatEl: null },
  );

  const derivedHandler = useMemo((): CursorHandler => ({
    onAttach(cursors) {
      const barDom  = domEl(cursors.barCursor);
      const beatDom = domEl(cursors.beatCursor);

      // Clear alphaTab's default background so only our inner content is visible.
      if (barDom)  barDom.style.background  = "transparent";
      if (beatDom) beatDom.style.background = "transparent";

      // Selection is managed by alphaTab internally — only the wrapper can be styled.
      addClasses(cursors.selectionWrapper, selectionClassName);

      // Create inner divs and append them INSIDE the cursor containers.
      // alphaTab positions/sizes the containers; our divs fill them via inset-0.
      const barEl  = makeInner(barClassName);
      const beatEl = makeInner(beatClassName);
      barDom?.appendChild(barEl);
      beatDom?.appendChild(beatEl);

      innerRef.current = { barEl, beatEl };
      setPortals({ bar: barEl, beat: beatEl });
    },

    onDetach(cursors) {
      innerRef.current.barEl?.remove();
      innerRef.current.beatEl?.remove();
      innerRef.current = { barEl: null, beatEl: null };
      setPortals({ bar: null, beat: null });

      const barDom  = domEl(cursors.barCursor);
      const beatDom = domEl(cursors.beatCursor);
      if (barDom)  barDom.style.background  = "";
      if (beatDom) beatDom.style.background = "";

      removeClasses(cursors.selectionWrapper, selectionClassName);
    },

    // alphaTab drives the outer container bounds via these methods.
    // Our inner divs (inset-0) follow automatically — no manual mirroring needed.

    placeBarCursor(barCursor, beatBounds) {
      const b = beatBounds.barBounds.masterBarBounds.visualBounds;
      barCursor.setBounds(b.x, b.y, b.w, b.h);
    },

    placeBeatCursor(beatCursor, beatBounds, startBeatX) {
      const b = beatBounds.barBounds.masterBarBounds.visualBounds;
      beatCursor.transitionToX(0, startBeatX);
      // beatContent: width=0 — content uses absolute positioning for its own width.
      // beatClassName only: beatWidth controls the container width.
      beatCursor.setBounds(startBeatX, b.y, beatContent !== undefined ? 0 : beatWidth, b.h);
    },

    // cursorMode === 1 (ToNextBext): double time + distance to prevent stalling.
    transitionBeatCursor(beatCursor, _beatBounds, startBeatX, nextBeatX, duration, cursorMode) {
      const factor = cursorMode === 1 ? 2 : 1;
      beatCursor.transitionToX(
        duration * factor,
        startBeatX + (nextBeatX - startBeatX) * factor,
      );
    },
  }), [barClassName, beatClassName, beatWidth, beatContent, selectionClassName]);

  const activeHandler = handler ?? derivedHandler;

  useEffect(() => {
    if (!api) return;
    api.customCursorHandler = activeHandler;
    return () => {
      api.customCursorHandler = undefined;
    };
  }, [api, activeHandler]);

  return (
    <>
      {portals.bar  && barContent  && createPortal(barContent,  portals.bar)}
      {portals.beat && beatContent && createPortal(beatContent, portals.beat)}
    </>
  );
}
