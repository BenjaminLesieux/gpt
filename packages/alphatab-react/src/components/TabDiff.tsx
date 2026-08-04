import {
  useRef,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  alignedSystems,
  changedBars,
  changedContent,
  DEFAULT_BARS_PER_ROW,
  type ChangedBar,
  type ContentMark,
  type ScoreDiff,
} from "@gpt/gpt-core";
import { Root } from "./Root";
import { Viewport } from "./Viewport";
import { useAlphaTabContext } from "../context/AlphaTabContext";
import type {
  AlphaTabApi,
  AlphaTabSettings,
  Bounds,
  BoundsLookup,
  MasterBarBounds,
} from "../types/events";

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
  /**
   * Index into `diff.tracks`. Both panes render that instrument alone and
   * highlight only its bars; `null` renders every track and highlights every
   * measure the edit touched.
   * @default null
   */
  trackIndex?: number | null;
  settings?: AlphaTabSettings;
  /**
   * How many bars each row aims for. Both panes break their rows at the same
   * aligned measures, so a row can end up wider than this where one score has
   * measures the other does not.
   *
   * Omit to derive it from the width of a pane. Fixing it means fixing it at
   * every window size: rows here are laid out from the model rather than from
   * what fits, so a count that reads well wide will crowd when narrow.
   */
  barsPerRow?: number;
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
//
// Red is what the edit took away, green what it brought — a note whose fret went
// from 1 to 2 is red on the left and green on the right. Orange never fills a
// measure; it only ticks the edge of one that was touched, so the eye lands on
// the measure and then on the note inside it.

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

// A note head is a few pixels across, so its highlight has to be denser than a
// whole-measure wash to read at all.
const MARK_FILL: Record<BarChangeType, string> = {
  added:   "oklch(58% 0.13 145 / 32%)",
  removed: "oklch(55% 0.16 22  / 32%)",
  changed: "oklch(65% 0.14 60  / 32%)",
};

/** Pane width a bar wants before its notes start to crowd, in px. */
const BAR_WIDTH = 175;
/** However wide the window gets, a row of more than this is a wall of notes. */
const MAX_BARS_PER_ROW = 6;

/** Breathing room around a note head, in px, so the glyph is not clipped. */
const NOTE_PADDING = 3;
/** Beats are already generously bounded; only the baseline needs a little slack. */
const BEAT_PADDING = 1;

// ─── BarOverlays ─────────────────────────────────────────────────────────────

interface BarOverlaysProps {
  /** Whole measures the edit added, removed, or touched. */
  specs: OverlaySpec[];
  /** The notes and beats inside a touched measure that actually changed. */
  marks: ContentMark[];
  /** What the marks mean in this pane — "removed" on the left, "added" on the right. */
  markType: BarChangeType;
  fill: Record<BarChangeType, string>;
  stroke: Record<BarChangeType, string>;
  /** Called after each paint with the computed pixel rects. */
  onPainted?: (rects: PaintedRect[]) => void;
}

function BarOverlays({
  specs,
  marks,
  markType,
  fill,
  stroke,
  onPainted,
}: BarOverlaysProps) {
  const { api, viewportEl } = useAlphaTabContext();
  const fillRef = useRef(fill);
  fillRef.current = fill;
  const strokeRef = useRef(stroke);
  strokeRef.current = stroke;
  const onPaintedRef = useRef(onPainted);
  onPaintedRef.current = onPainted;

  const specsKey = useMemo(
    () =>
      [
        specs.map((s) => `${s.masterBarIndex}:${s.type}`).join(","),
        markType,
        marks
          .map(
            (m) =>
              `${m.masterBarIndex}/${m.trackIndex}/${m.staffIndex}/${m.voiceIndex}/${m.beatIndex}/${m.noteIndex}`,
          )
          .join(","),
      ].join("|"),
    [specs, marks, markType],
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

      const add = (rect: PaintedRect, style: string) => {
        const el = document.createElement("div");
        el.style.cssText = [
          "position:absolute",
          `left:${rect.x}px`,
          `top:${rect.y}px`,
          `width:${rect.w}px`,
          `height:${rect.h}px`,
          "box-sizing:border-box",
          style,
        ].join(";");
        container.appendChild(el);
        painted.push(rect);
      };

      if (lookup) {
        // A measure the edit rewrote is not uniformly changed, so it gets an
        // edge tick rather than a wash — the notes below carry the colour.
        for (const { masterBarIndex, type } of specs) {
          const mb = lookup.findMasterBarByIndex(masterBarIndex);
          if (!mb) continue;
          const { x, y, w, h } = mb.visualBounds;
          const background =
            type === "changed" ? "transparent" : fillRef.current[type];
          add(
            { x, y, w, h, type },
            `background:${background};border-left:2px solid ${strokeRef.current[type]}`,
          );
        }

        for (const mark of marks) {
          const rect = markRect(lookup, mark);
          if (!rect) continue;
          add(
            { ...rect, type: markType },
            [
              `background:${MARK_FILL[markType]}`,
              `border:1px solid ${strokeRef.current[markType]}`,
              "border-radius:3px",
            ].join(";"),
          );
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

// ─── Locating a mark on the page ─────────────────────────────────────────────
//
// gpt-core addresses a mark by model position — measure, track, staff, voice,
// beat, note — because that is what survives being serialized and what a second
// pane can be addressed by. Turning that into pixels is this function's job.
//
// The walk goes through the beat, never through BarBounds.bar. Rendering happens
// in a worker and the lookup is revived from JSON on the main thread, and that
// revival only relinks BeatBounds.beat — BarBounds.bar comes back undefined. The
// beat carries the same answer (its voice knows its bar, which knows its staff
// and track) and carries it on both rendering paths.

type Rect = Pick<PaintedRect, "x" | "y" | "w" | "h">;

function markRect(lookup: BoundsLookup, mark: ContentMark): Rect | null {
  const mb = lookup.findMasterBarByIndex(mark.masterBarIndex);
  if (!mb) return null;

  for (const barBounds of mb.bars) {
    for (const beatBounds of barBounds.beats) {
      const beat = beatBounds.beat;
      const staff = beat?.voice?.bar?.staff;
      if (
        !staff ||
        staff.track?.index !== mark.trackIndex ||
        staff.index !== mark.staffIndex ||
        beat.voice.index !== mark.voiceIndex ||
        beat.index !== mark.beatIndex
      ) {
        continue;
      }

      if (mark.noteIndex !== null) {
        // Note bounds only exist when core.includeNoteBounds was set before the
        // render; without them the beat is the tightest honest answer.
        const note = beat.notes[mark.noteIndex];
        const noteBounds = note
          ? beatBounds.notes?.find((n) => n.note === note)
          : undefined;
        if (noteBounds) return pad(noteBounds.noteHeadBounds, NOTE_PADDING);
      }

      return pad(beatBounds.visualBounds, BEAT_PADDING);
    }
  }

  return null;
}

function pad(bounds: Rect | Bounds, by: number): Rect {
  const { x, y, w, h } = bounds;
  return { x: x - by, y: y - by, w: w + by * 2, h: h + by * 2 };
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
      // A changed measure and the note inside it land on the same pixel row, so
      // the note's colour is drawn last — it is the more specific answer.
      .sort((a, b) => {
        const order = { changed: 0, removed: 1, added: 2 };
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

// ─── Keeping the panes level ─────────────────────────────────────────────────
//
// Matching row breaks get measure 99 onto row k in both panes, but not onto the
// same pixel: a row is as tall as what is in it, and a bend or a second voice on
// one side pushes everything below it down. So the panes are tied by the measure
// at the top of the viewport rather than by the number of pixels scrolled.

type Side = "base" | "head";

/** Measures both scores have, in reading order — what a pane can be anchored on. */
type MeasurePair = readonly [base: number, head: number];

/**
 * The other pane's index for `index`, or the nearest one before it. A measure
 * only one score has (the anchor sits on an insertion) has no counterpart of
 * its own; the measure before it is where the reader's eye already is.
 */
function counterpart(
  pairs: MeasurePair[],
  index: number,
  from: Side,
): number | null {
  const self = from === "base" ? 0 : 1;
  const other = from === "base" ? 1 : 0;
  let found: number | null = null;
  for (const pair of pairs) {
    if (pair[self] > index) break;
    found = pair[other];
  }
  return found;
}

/** The row at the top of the viewport, and the first of its bars that the other pane also has. */
function anchorBar(
  api: AlphaTabApi | null,
  scrollTop: number,
  pairs: MeasurePair[],
  side: Side,
): { bar: MasterBarBounds; mate: number } | null {
  const systems = api?.boundsLookup?.staffSystems;
  if (!systems?.length) return null;

  let row = systems[systems.length - 1]!;
  for (const system of systems) {
    if (system.realBounds.y + system.realBounds.h > scrollTop) {
      row = system;
      break;
    }
  }

  for (const bar of row.bars) {
    const mate = counterpart(pairs, bar.index, side);
    if (mate !== null) return { bar, mate };
  }
  return null;
}

// ─── TabDiff ──────────────────────────────────────────────────────────────────

export function TabDiff({
  base,
  head,
  diff,
  trackIndex = null,
  settings,
  barsPerRow,
  colors,
  borderColors,
  baseLabel = "Before",
  headLabel = "After",
  className,
  style,
}: TabDiffProps) {
  // The alignment is score-level; a track's changes are derived from it on demand.
  const bars = useMemo<ChangedBar[]>(
    () => changedBars(diff, trackIndex),
    [diff, trackIndex],
  );

  // …and within a changed measure, which notes actually moved.
  const content = useMemo(
    () => changedContent(diff, trackIndex),
    [diff, trackIndex],
  );

  // Each pane addresses tracks by its own score's ordering, and the two diverge
  // whenever tracks are added, dropped, or dragged around in Guitar Pro. A pane
  // whose score never had this track falls back to rendering all of them — the
  // overlay is what says the part is new or gone.
  const pairing = trackIndex === null ? null : diff.tracks[trackIndex];
  const baseTracks = useMemo(
    () => (pairing?.baseTrack != null ? [pairing.baseTrack] : undefined),
    [pairing],
  );
  const headTracks = useMemo(
    () => (pairing?.headTrack != null ? [pairing.headTrack] : undefined),
    [pairing],
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
        .filter((b) => b.baseIndex !== null)
        .map((b) => ({ masterBarIndex: b.baseIndex!, type: b.type })),
    [bars],
  );

  const headSpecs = useMemo<OverlaySpec[]>(
    () =>
      bars
        .filter((b) => b.headIndex !== null)
        .map((b) => ({ masterBarIndex: b.headIndex!, type: b.type })),
    [bars],
  );

  const paneSettings = useMemo<AlphaTabSettings>(
    () => ({
      ...settings,
      core: {
        engine: "svg",
        logLevel: "error",
        ...(settings as Record<string, unknown>)?.core as object | undefined,
        // Without this the bounds lookup stops at the beat and a changed note
        // can only be highlighted as the whole beat it sits in.
        includeNoteBounds: true,
      },
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

  // ── Matching row breaks ───────────────────────────────────────────────────
  // Left to itself each pane breaks its rows where its own content happens to
  // fit, so the same measure lands on a different row on each side. One plan,
  // derived from the alignment, is handed to both.
  //
  // Taking the row breaks over means giving up alphaTab's fitting, so the count
  // has to be answered here instead — from how wide a pane currently is.
  const containerRef = useRef<HTMLDivElement>(null);
  const [fittedBarsPerRow, setFittedBarsPerRow] = useState(DEFAULT_BARS_PER_ROW);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || barsPerRow !== undefined) return;

    const fit = () => {
      const pane = el.clientWidth / 2;
      setFittedBarsPerRow(
        Math.max(1, Math.min(MAX_BARS_PER_ROW, Math.round(pane / BAR_WIDTH))),
      );
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [barsPerRow]);

  const systems = useMemo(
    () => alignedSystems(diff.measures, barsPerRow ?? fittedBarsPerRow),
    [diff, barsPerRow, fittedBarsPerRow],
  );
  const baseSystems = systems.base.length ? systems.base : undefined;
  const headSystems = systems.head.length ? systems.head : undefined;

  // ── Synchronized scroll ───────────────────────────────────────────────────
  const baseScrollRef = useRef<HTMLDivElement>(null);
  const headScrollRef = useRef<HTMLDivElement>(null);
  const baseApi = useRef<AlphaTabApi | null>(null);
  const headApi = useRef<AlphaTabApi | null>(null);
  // Where each pane was last put by the other one, so its echo of that move can
  // be told apart from a scroll the reader actually made.
  const moved = useRef<Record<Side, number | null>>({ base: null, head: null });

  const pairs = useMemo<MeasurePair[]>(
    () =>
      diff.measures
        .filter((m) => m.baseIndex !== null && m.headIndex !== null)
        .map((m) => [m.baseIndex!, m.headIndex!] as const),
    [diff],
  );

  /** Puts the pane opposite `from` at the same measure, at the same height. */
  const align = useCallback(
    (from: Side) => {
      const fromBase = from === "base";
      const source = (fromBase ? baseScrollRef : headScrollRef).current;
      const target = (fromBase ? headScrollRef : baseScrollRef).current;
      if (!source || !target) return;

      target.scrollLeft = source.scrollLeft;

      const anchor = anchorBar(
        (fromBase ? baseApi : headApi).current,
        source.scrollTop,
        pairs,
        from,
      );
      const mate = anchor
        ? (fromBase ? headApi : baseApi).current?.boundsLookup?.findMasterBarByIndex(
            anchor.mate,
          )
        : null;

      // Without a lookup on both sides — the first paint has not landed yet —
      // pixels are the only answer available, and they are right often enough.
      const top = anchor && mate
        ? source.scrollTop + (mate.realBounds.y - anchor.bar.realBounds.y)
        : source.scrollTop;

      const max = Math.max(0, target.scrollHeight - target.clientHeight);
      const next = Math.max(0, Math.min(max, top));
      if (Math.abs(target.scrollTop - next) <= 1) return;

      target.scrollTop = next;
      // What the browser settled on, not what was asked for: clamping and
      // sub-pixel rounding both move it, and this has to match the scrollTop
      // the echoed event will report exactly.
      moved.current[fromBase ? "head" : "base"] = target.scrollTop;
    },
    [pairs],
  );

  // The move above fires a scroll event on the pane that was moved, which would
  // ask this pane to align back. Its answer is not always the same pixel — the
  // two panes anchor on different rows near a row boundary — so left alone the
  // panes trade scroll events until the tab stops responding. An echo of a move
  // we made is not news, so it is dropped.
  const alignFrom = useCallback(
    (side: Side) => {
      const el = (side === "base" ? baseScrollRef : headScrollRef).current;
      const expected = moved.current[side];
      moved.current[side] = null;
      if (el && expected !== null && Math.abs(el.scrollTop - expected) <= 1) return;
      align(side);
    },
    [align],
  );

  useEffect(() => {
    const baseEl = baseScrollRef.current;
    const headEl = headScrollRef.current;
    if (!baseEl || !headEl) return;

    const fromBase = () => alignFrom("base");
    const fromHead = () => alignFrom("head");
    baseEl.addEventListener("scroll", fromBase, { passive: true });
    headEl.addEventListener("scroll", fromHead, { passive: true });
    return () => {
      baseEl.removeEventListener("scroll", fromBase);
      headEl.removeEventListener("scroll", fromHead);
    };
  }, [alignFrom]);

  // A re-render moves every bar, so whatever the panes agreed on is stale.
  // Head is the pane that holds still; base is the one that follows it.
  const realign = useCallback(() => align("head"), [align]);

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
    if (!headEl) return;
    const newTop = ratio * headEl.scrollHeight;
    headEl.scrollTop = newTop;
    // The gutter points at head, so head moves first and base is brought level
    // with it — landing both panes on the measure the click was aimed at.
    align("head");
    setScrollInfo((s) => ({ ...s, top: newTop }));
  }, [align]);

  // ── Layout ────────────────────────────────────────────────────────────────
  const paneStyle: CSSProperties = {
    display: "flex", flexDirection: "column", flex: 1, minWidth: 0, overflow: "hidden",
  };
  const scrollStyle: CSSProperties = {
    flex: 1, minHeight: 0, overflow: "auto", position: "relative",
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ display: "flex", minHeight: 0, flex: 1, overflow: "hidden", ...style }}
    >
      {/* ── Base pane ────────────────── */}
      <div style={paneStyle}>
        <DiffPaneHeader label={baseLabel} {...baseCounts} fill={resolvedFill} />
        <div ref={baseScrollRef} style={scrollStyle}>
          <Root
            src={base}
            tracks={baseTracks}
            systemsLayout={baseSystems}
            settings={paneSettings}
            onApiReady={(api) => { baseApi.current = api; }}
            onPostRenderFinished={realign}
          >
            <BarOverlays
              specs={baseSpecs}
              marks={content.base}
              markType="removed"
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
          <Root
            src={head}
            tracks={headTracks}
            systemsLayout={headSystems}
            settings={paneSettings}
            onApiReady={(api) => { headApi.current = api; }}
            onPostRenderFinished={realign}
          >
            <BarOverlays
              specs={headSpecs}
              marks={content.head}
              markType="added"
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
