import { useRef, useEffect, useCallback, type CSSProperties, type HTMLAttributes } from "react";
import { useAlphaTabContext } from "../context/AlphaTabContext";
import { useAutoScroll } from "../hooks/useAutoScroll";
import type { CursorClassNames } from "../types/events";

export interface ViewportProps extends Omit<HTMLAttributes<HTMLDivElement>, "ref"> {
  /**
   * Tailwind (or any CSS) classes injected onto alphaTab's cursor DOM elements.
   * Omit a key to keep the built-in default. Pass `""` to clear it.
   *
   * @example
   * <AlphaTab.Viewport
   *   cursorClassNames={{
   *     bar:            "bg-yellow-400/20 rounded",
   *     beat:           "bg-yellow-400 !w-0.5 rounded-full",
   *     selection:      "bg-blue-400/10",
   *     highlightColor: "#facc15",
   *   }}
   * />
   */
  cursorClassNames?: CursorClassNames;
}

// Defaults written as literals so Tailwind's static scanner includes them.
const DEFAULT_BAR_CLASS       = "bg-warning/18";
const DEFAULT_BEAT_CLASS      = "bg-warning/85";
const DEFAULT_SELECTION_CLASS = "bg-warning/14";

function applyClasses(el: Element | null, next: string, prev: string) {
  if (!el) return;
  prev.split(/\s+/).filter(Boolean).forEach(c => el.classList.remove(c));
  next.split(/\s+/).filter(Boolean).forEach(c => el.classList.add(c));
}

/**
 * The container div that AlphaTab renders into.
 * Must be rendered inside an <AlphaTab.Root>.
 */
export function Viewport({ style, cursorClassNames, ...props }: ViewportProps) {
  const { api, _registerViewport } = useAlphaTabContext();
  const containerRef = useRef<HTMLElement | null>(null);
  useAutoScroll();

  // Ref callback: register with alphaTab AND capture locally.
  const ref = useCallback(
    (el: HTMLElement | null) => {
      containerRef.current = el;
      _registerViewport(el);
    },
    [_registerViewport],
  );

  // Resolve effective classes (undefined → default, "" → nothing).
  const barClass       = cursorClassNames?.bar       ?? DEFAULT_BAR_CLASS;
  const beatClass      = cursorClassNames?.beat      ?? DEFAULT_BEAT_CLASS;
  const selClass       = cursorClassNames?.selection ?? DEFAULT_SELECTION_CLASS;
  const highlightColor = cursorClassNames?.highlightColor;

  // Inject classes onto the cursor elements after every render cycle.
  // postRenderFinished fires when alphaTab has finished laying out the score —
  // the cursor elements exist in the DOM at that point.
  // We track prev classes in a ref so we can swap them cleanly on prop change.
  const prevClasses = useRef({ bar: "", beat: "", sel: "" });

  useEffect(() => {
    if (!api) return;

    const apply = () => {
      const c = containerRef.current;
      if (!c) return;
      const prev = prevClasses.current;
      applyClasses(c.querySelector(".at-cursor-bar"),  barClass,  prev.bar);
      applyClasses(c.querySelector(".at-cursor-beat"), beatClass, prev.beat);
      applyClasses(c.querySelector(".at-selection"),   selClass,  prev.sel);
      prevClasses.current = { bar: barClass, beat: beatClass, sel: selClass };
    };

    api.postRenderFinished.on(apply);
    apply(); // also apply immediately if elements already exist

    return () => {
      api.postRenderFinished.off(apply);
    };
    // Primitive string deps — re-runs only when a class string actually changes.
  }, [api, barClass, beatClass, selClass]);

  const mergedStyle: CSSProperties = {
    width: "100%",
    overflow: "auto",
    ...(highlightColor ? { "--at-highlight-color": highlightColor } as CSSProperties : undefined),
    ...style,
  };

  return (
    <div
      ref={ref}
      style={mergedStyle}
      {...props}
    />
  );
}
