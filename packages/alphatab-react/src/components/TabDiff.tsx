import {
  useRef,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type CSSProperties,
  type ReactNode,
} from "react";
import { barsForTrack, type BarDiff, type ScoreDiff } from "@gpt/gpt-core";
import { Root } from "./Root";
import { Viewport } from "./Viewport";
import { useAlphaTabContext } from "../context/AlphaTabContext";
import type { AlphaTabSettings } from "../types/events";

// ─── Types ────────────────────────────────────────────────────────────────────

type BarChangeType = "added" | "removed" | "changed";

interface OverlaySpec {
  masterBarIndex: number;
  type: BarChangeType;
}

interface PaintedRect {
  x: number;
  y: number;
  w: number;
  h: number;
  type: BarChangeType;
}

export interface TabDiffColorConfig {
  added?: string;
  removed?: string;
  changed?: string;
}

export interface TabDiffBorderConfig {
  added?: string;
  removed?: string;
  changed?: string;
}

export interface TabDiffProps {
  base: Uint8Array | null;
  head: Uint8Array | null;
  diff: ScoreDiff;
  /** @default 0 */
  trackIndex?: number;
  settings?: AlphaTabSettings;
  colors?: TabDiffColorConfig;
  borderColors?: TabDiffBorderConfig;
  /** @default "Before" */
  baseLabel?: string;
  /** @default "After" */
  headLabel?: string;
  className?: string;
  style?: CSSProperties;
}

// ─── Default colors ───────────────────────────────────────────────────────────

const FILL: Record<BarChangeType, string> = {
  added:   "oklch(58% 0.13 145 / 18%)",
  removed: "oklch(55% 0.16 22  / 18%)",
  changed: "oklch(65% 0.14 60  / 18%)",
};

const STROKE: Record<BarChangeType, string> = {
  added:   "oklch(58% 0.13 145 / 70%)",
  removed: "oklch(55% 0.16 22  / 70%)",
  changed: "oklch(65% 0.14 60  / 70%)",
};

// ─── BarOverlays ─────────────────────────────────────────────────────────────

interface BarOverlaysProps {
  specs: OverlaySpec[];
  fill: Record<BarChangeType, string>;
  stroke: Record<BarChangeType, string>;
  /** Called after each paint with the computed pixel rects. */
  onPainted?: (rects: PaintedRect[]) => void;
}

function BarOverlays({ specs, fill, stroke, onPainted }: BarOverlaysProps) {
  const { api, viewportEl } = useAlphaTabContext();
  const fillRef = useRef(fill);
  fillRef.current = fill;
  const strokeRef = useRef(stroke);
  strokeRef.current = stroke;
  const onPaintedRef = useRef(onPainted);
  onPaintedRef.current = onPainted;

  const specsKey = useMemo(
    () => specs.map((s) => `${s.masterBarIndex}:${s.type}`).join(","),
    [specs],
  );

  useEffect(() => {
    if (!api || !viewportEl) return;

    const container = document.createElement("div");
    container.style.cssText =
      "position:absolute;inset:0;pointer-events:none;overflow:visible;";
    viewportEl.appendChild(container);

    const paint = () => {
      const lookup = api.boundsLookup;
      container.innerHTML = "";
      const painted: PaintedRect[] = [];

      if (lookup && specs.length > 0) {
        for (const { masterBarIndex, type } of specs) {
          const mb = lookup.findMasterBarByIndex(masterBarIndex);
          if (!mb) continue;
          const { x, y, w, h } = mb.visualBounds;
          const el = document.createElement("div");
          el.style.cssText = [
            "position:absolute",
            `left:${x}px`,
            `top:${y}px`,
            `width:${w}px`,
            `height:${h}px`,
            `background:${fillRef.current[type]}`,
            `border-left:2px solid ${strokeRef.current[type]}`,
            "box-sizing:border-box",
          ].join(";");
          container.appendChild(el);
          painted.push({ x, y, w, h, type });
        }
      }

      onPaintedRef.current?.(painted);
    };

    api.postRenderFinished.on(paint);
    paint();

    return () => {
      api.postRenderFinished.off(paint);
      if (viewportEl.contains(container)) viewportEl.removeChild(container);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, viewportEl, specsKey]);

  return null;
}

// ─── DiffGutter ──────────────────────────────────────────────────────────────
// JetBrains-style mini-map strip. Shows a proportional marker for every
// changed bar and a viewport indicator rectangle.

interface GutterProps {
  /** All painted rects from both panes, with their pixel y position. */
  rects: PaintedRect[];
  /** Total scrollable height of the reference (head) scroll container. */
  scrollHeight: number;
  /** Current scrollTop of the head scroll container. */
  scrollTop: number;
  /** Visible height of the head scroll container. */
  viewportHeight: number;
  fill: Record<BarChangeType, string>;
  stroke: Record<BarChangeType, string>;
  /** Called with a 0–1 ratio to navigate both panes there. */
  onNavigate: (ratio: number) => void;
}

function DiffGutter({
  rects,
  scrollHeight,
  scrollTop,
  viewportHeight,
  fill,
  stroke,
  onNavigate,
}: GutterProps) {
  const gutterRef = useRef<HTMLDivElement>(null);

  const handlePointer = useCallback(
    (e: React.MouseEvent) => {
      const el = gutterRef.current;
      if (!el) return;
      const { top, height } = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientY - top) / height));
      onNavigate(ratio);
    },
    [onNavigate],
  );

  const total = scrollHeight > 0 ? scrollHeight : 1;
  const vpRatio = Math.min(1, viewportHeight / total);
  const scrollRatio = Math.min(1 - vpRatio, scrollTop / total);

  // De-duplicate rects that overlap so the gutter stays readable.
  const markers = useMemo(() => {
    const MIN_H_PX = 3; // minimum visible height in gutter px
    return rects
      .map((r) => ({
        top:    r.y / total,
        height: Math.max(MIN_H_PX / 100, r.h / total),
        type:   r.type,
      }))
      // Sort so "changed" renders on top of "added/removed"
      .sort((a, b) => {
        const order = { removed: 0, added: 1, changed: 2 };
        return order[a.type] - order[b.type];
      });
  }, [rects, total]);

  return (
    <div
      ref={gutterRef}
      onClick={handlePointer}
      style={{
        width: "12px",
        flexShrink: 0,
        position: "relative",
        background: "rgba(0,0,0,0.5)",
        borderLeft: "1px solid rgba(255,255,255,0.05)",
        cursor: "pointer",
        userSelect: "none",
      }}
      aria-label="Diff mini-map — click to navigate"
    >
      {/* Viewport indicator */}
      <div
        style={{
          position: "absolute",
          top: `${scrollRatio * 100}%`,
          height: `${vpRatio * 100}%`,
          left: 0,
          right: 0,
          background: "rgba(255,255,255,0.06)",
          borderTop: "1px solid rgba(255,255,255,0.18)",
          borderBottom: "1px solid rgba(255,255,255,0.18)",
          pointerEvents: "none",
          boxSizing: "border-box",
          transition: "top 80ms linear",
        }}
      />

      {/* Change markers */}
      {markers.map((m, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: `${m.top * 100}%`,
            height: `${m.height * 100}%`,
            left: "2px",
            right: "2px",
            minHeight: "3px",
            background: fill[m.type],
            borderLeft: `2px solid ${stroke[m.type]}`,
            boxSizing: "border-box",
            pointerEvents: "none",
          }}
        />
      ))}
    </div>
  );
}

// ─── Pane header ─────────────────────────────────────────────────────────────

function DiffPaneHeader({
  label,
  added,
  removed,
  changed,
  fill,
}: {
  label: string;
  added: number;
  removed: number;
  changed: number;
  fill: Record<BarChangeType, string>;
}): ReactNode {
  const total = added + removed + changed;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "6px 14px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        fontSize: "11px",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.45)",
        flexShrink: 0,
        background: "rgba(0,0,0,0.25)",
      }}
    >
      <span style={{ color: "rgba(255,255,255,0.75)", fontWeight: 600 }}>{label}</span>
      <span style={{ display: "flex", gap: "6px", marginLeft: "auto" }}>
        {changed > 0 && <Chip count={changed} type="changed" fill={fill} />}
        {added   > 0 && <Chip count={added}   type="added"   fill={fill} />}
        {removed > 0 && <Chip count={removed} type="removed" fill={fill} />}
        {total === 0 && (
          <span style={{ color: "rgba(255,255,255,0.22)", fontSize: "10px" }}>
            unchanged
          </span>
        )}
      </span>
    </div>
  );
}

function Chip({ count, type, fill }: { count: number; type: BarChangeType; fill: Record<BarChangeType, string> }) {
  const labels: Record<BarChangeType, string> = { added: "A", removed: "R", changed: "C" };
  return (
    <span
      title={`${count} bars ${type}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "3px",
        padding: "1px 5px",
        borderRadius: "2px",
        background: fill[type],
        color: "rgba(255,255,255,0.75)",
        fontFamily: "monospace",
        fontSize: "10px",
      }}
    >
      {count}
      <span style={{ opacity: 0.6 }}>{labels[type]}</span>
    </span>
  );
}

// ─── TabDiff ──────────────────────────────────────────────────────────────────

export function TabDiff({
  base,
  head,
  diff,
  trackIndex = 0,
  settings,
  colors,
  borderColors,
  baseLabel = "Before",
  headLabel = "After",
  className,
  style,
}: TabDiffProps) {
  // The alignment is score-level; a track's bars are derived from it on demand.
  const bars = useMemo<BarDiff[]>(
    () => barsForTrack(diff, trackIndex),
    [diff, trackIndex],
  );

  const resolvedFill: Record<BarChangeType, string> = {
    added:   colors?.added   ?? FILL.added,
    removed: colors?.removed ?? FILL.removed,
    changed: colors?.changed ?? FILL.changed,
  };
  const resolvedStroke: Record<BarChangeType, string> = {
    added:   borderColors?.added   ?? STROKE.added,
    removed: borderColors?.removed ?? STROKE.removed,
    changed: borderColors?.changed ?? STROKE.changed,
  };

  // ── Overlay specs ──────────────────────────────────────────────────────────
  // Each pane renders its own score, so each is addressed by its own index.
  // They diverge as soon as a measure is inserted or deleted: bar 12 of base can
  // be bar 13 of head. Using one index for both panes misaligns every highlight
  // after the first structural edit.
  const baseSpecs = useMemo<OverlaySpec[]>(
    () =>
      bars
        .filter((b) => b.type === "removed" || b.type === "changed")
        .map((b) => ({ masterBarIndex: b.baseIndex!, type: b.type as BarChangeType })),
    [bars],
  );

  const headSpecs = useMemo<OverlaySpec[]>(
    () =>
      bars
        .filter((b) => b.type === "added" || b.type === "changed")
        .map((b) => ({ masterBarIndex: b.headIndex!, type: b.type as BarChangeType })),
    [bars],
  );

  const paneSettings = useMemo<AlphaTabSettings>(
    () => ({
      ...settings,
      core: { engine: "svg", logLevel: "error", ...(settings as Record<string, unknown>)?.core as object | undefined },
      player: { enablePlayer: false },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const baseCounts = useMemo(() => ({
    changed: bars.filter((b) => b.type === "changed").length,
    removed: bars.filter((b) => b.type === "removed").length,
    added: 0,
  }), [bars]);

  const headCounts = useMemo(() => ({
    changed: bars.filter((b) => b.type === "changed").length,
    added:   bars.filter((b) => b.type === "added").length,
    removed: 0,
  }), [bars]);

  // ── Synchronized scroll ───────────────────────────────────────────────────
  const baseScrollRef = useRef<HTMLDivElement>(null);
  const headScrollRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  useEffect(() => {
    const baseEl = baseScrollRef.current;
    const headEl = headScrollRef.current;
    if (!baseEl || !headEl) return;

    const syncFrom =
      (source: HTMLDivElement, target: HTMLDivElement) => () => {
        if (isSyncing.current) return;
        isSyncing.current = true;
        target.scrollTop  = source.scrollTop;
        target.scrollLeft = source.scrollLeft;
        requestAnimationFrame(() => { isSyncing.current = false; });
      };

    const fromBase = syncFrom(baseEl, headEl);
    const fromHead = syncFrom(headEl, baseEl);
    baseEl.addEventListener("scroll", fromBase, { passive: true });
    headEl.addEventListener("scroll", fromHead, { passive: true });
    return () => {
      baseEl.removeEventListener("scroll", fromBase);
      headEl.removeEventListener("scroll", fromHead);
    };
  }, []);

  // ── Gutter scroll state ───────────────────────────────────────────────────
  const [scrollInfo, setScrollInfo] = useState({ top: 0, total: 1, viewport: 0 });

  useEffect(() => {
    const el = headScrollRef.current;
    if (!el) return;

    const update = () =>
      setScrollInfo({ top: el.scrollTop, total: el.scrollHeight, viewport: el.clientHeight });

    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, []);

  // ── Gutter bar rects (reported from BarOverlays callbacks) ───────────────
  const [baseRects, setBaseRects] = useState<PaintedRect[]>([]);
  const [headRects, setHeadRects] = useState<PaintedRect[]>([]);

  const allRects = useMemo(
    () => [...baseRects, ...headRects],
    [baseRects, headRects],
  );

  // ── Gutter navigation ─────────────────────────────────────────────────────
  const navigateTo = useCallback((ratio: number) => {
    const headEl = headScrollRef.current;
    const baseEl = baseScrollRef.current;
    if (!headEl) return;
    const newTop = ratio * headEl.scrollHeight;
    isSyncing.current = true;
    headEl.scrollTop = newTop;
    if (baseEl) baseEl.scrollTop = newTop;
    requestAnimationFrame(() => { isSyncing.current = false; });
    setScrollInfo((s) => ({ ...s, top: newTop }));
  }, []);

  // ── Layout ────────────────────────────────────────────────────────────────
  const paneStyle: CSSProperties = {
    display: "flex", flexDirection: "column", flex: 1, minWidth: 0, overflow: "hidden",
  };
  const scrollStyle: CSSProperties = {
    flex: 1, minHeight: 0, overflow: "auto", position: "relative",
  };

  return (
    <div
      className={className}
      style={{ display: "flex", minHeight: 0, flex: 1, overflow: "hidden", ...style }}
    >
      {/* ── Base pane ────────────────── */}
      <div style={paneStyle}>
        <DiffPaneHeader label={baseLabel} {...baseCounts} fill={resolvedFill} />
        <div ref={baseScrollRef} style={scrollStyle}>
          <Root src={base} settings={paneSettings}>
            <BarOverlays
              specs={baseSpecs}
              fill={resolvedFill}
              stroke={resolvedStroke}
              onPainted={setBaseRects}
            />
            <Viewport style={{ width: "100%" }} />
          </Root>
        </div>
      </div>

      {/* ── Divider ──────────────────── */}
      <div style={{ width: "1px", flexShrink: 0, background: "rgba(255,255,255,0.08)" }} />

      {/* ── Head pane ────────────────── */}
      <div style={paneStyle}>
        <DiffPaneHeader label={headLabel} {...headCounts} fill={resolvedFill} />
        <div ref={headScrollRef} style={scrollStyle}>
          <Root src={head} settings={paneSettings}>
            <BarOverlays
              specs={headSpecs}
              fill={resolvedFill}
              stroke={resolvedStroke}
              onPainted={setHeadRects}
            />
            <Viewport style={{ width: "100%" }} />
          </Root>
        </div>
      </div>

      {/* ── Gutter ───────────────────── */}
      <DiffGutter
        rects={allRects}
        scrollHeight={scrollInfo.total}
        scrollTop={scrollInfo.top}
        viewportHeight={scrollInfo.viewport}
        fill={resolvedFill}
        stroke={resolvedStroke}
        onNavigate={navigateTo}
      />
    </div>
  );
}
