import type { Gutter } from './lanes';

/**
 * The graph, drawn beside the list.
 *
 * It is decoration in the accessibility tree and nothing else: `aria-hidden`,
 * no text, no focus. Everything it says is said again in the row next to it —
 * a branch chip, a *Current version* badge — because a screen reader gets the
 * list and never the drawing.
 *
 * The geometry is fixed and given in numbers rather than eyeballed: lanes are
 * 24 apart at x = 20, 44, 68 in an 80-wide gutter, nodes are squares centred
 * on the lane at the row's midline, and there are exactly two curve shapes —
 * one for a branch starting, one for a branch landing. Anything a developer
 * has to judge by eye is wrong on the second render.
 */

/** Lane centres. Three is the ceiling; the width budget is built for it. */
const LANE = [20, 44, 68];

/**
 * Brightest is the main line, branches are the same grey dimmer — never a
 * different hue. The values are design-system tokens rather than literals
 * here: the graph greys are a real sub-palette, and a second copy of them in
 * a component is a second place for the theme to drift.
 */
const MAIN_STROKE = 'var(--color-graph-line)';
const BRANCH_STROKE = 'var(--color-graph-line-branch)';
const WIDTH = 1.25;

const MAIN_NODE = 'var(--color-graph-node)';
const BRANCH_NODE = 'var(--color-fg-2)';
const SELECTED_NODE = 'var(--color-fg-1)';

export interface HistoryGutterProps extends Gutter {
  /** Matches the row it sits beside: 40 for a version, 32 for a day header. */
  height?: number;
  /**
   * Below 800px of list the lanes collapse to one 24px rail. They degrade rather than
   * shrink — three verticals in 24px is a smudge, not a graph.
   */
  narrow?: boolean;
}

export function HistoryGutter({
  main,
  l2,
  l3,
  node,
  height = 40,
  narrow = false,
}: HistoryGutterProps) {
  const width = narrow ? 24 : 80;
  const mid = height / 2;
  const lanes = narrow ? [12, 12, 12] : LANE;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      focusable="false"
      className="block flex-none"
    >
      <Vertical x={lanes[0]} state={main} height={height} stroke={MAIN_STROKE} />
      {/* One rail when narrow: a branch there is a labelled group in the list,
          not a second vertical. */}
      {!narrow && (
        <>
          <Vertical x={lanes[1]} state={l2} height={height} stroke={BRANCH_STROKE} join={lanes[0]} />
          <Vertical x={lanes[2]} state={l3} height={height} stroke={BRANCH_STROKE} join={lanes[0]} />
        </>
      )}
      <Node kind={node} lanes={lanes} mid={mid} />
    </svg>
  );
}

function Vertical({
  x,
  state,
  height,
  stroke,
  join,
}: {
  x: number;
  state: Gutter['main'] | Gutter['l2'];
  height: number;
  stroke: string;
  /** The lane a curve bends into. Only branches curve; the main line never does. */
  join?: number;
}) {
  const mid = height / 2;
  // Past the edges on purpose: a 1px row border must not leave a gap in a
  // line that is meant to read as continuous down the whole list.
  const top = -1;
  const bottom = height + 1;

  switch (state) {
    case 'none':
      return null;
    case 'full':
      return <line x1={x} y1={top} x2={x} y2={bottom} stroke={stroke} strokeWidth={WIDTH} />;
    case 'top':
      return <line x1={x} y1={top} x2={x} y2={mid} stroke={stroke} strokeWidth={WIDTH} />;
    case 'bottom':
    case 'tip':
      return <line x1={x} y1={mid} x2={x} y2={bottom} stroke={stroke} strokeWidth={WIDTH} />;
    case 'base':
      // A branch leaving the version it grew from, read downwards.
      return (
        <path
          d={`M${x} ${top} V${mid - 12} C${x} ${mid - 2} ${join} ${mid - 8} ${join} ${mid}`}
          fill="none"
          stroke={stroke}
          strokeWidth={WIDTH}
        />
      );
    case 'knot':
      // The same shape mirrored: a branch arriving at where it landed.
      return (
        <path
          d={`M${x} ${bottom} V${mid + 10} C${x} ${mid + 2} ${join} ${mid + 8} ${join} ${mid}`}
          fill="none"
          stroke={stroke}
          strokeWidth={WIDTH}
        />
      );
  }
}

function Node({ kind, lanes, mid }: { kind: Gutter['node']; lanes: number[]; mid: number }) {
  if (kind === 'none') return null;

  const at = kind === 'l2' ? lanes[1] : kind === 'l3' ? lanes[2] : lanes[0];

  /** Squares, never circles, and centred on the lane. */
  const square = (size: number, fill: string) => (
    <rect x={at - size / 2} y={mid - size / 2} width={size} height={size} rx={2} fill={fill} />
  );

  switch (kind) {
    case 'main':
      return square(8, MAIN_NODE);
    case 'l2':
    case 'l3':
      return square(8, BRANCH_NODE);
    case 'sel':
      return square(10, SELECTED_NODE);
    case 'head':
      // The one place the accent is spent on this screen.
      return (
        <>
          <rect
            x={at - 8}
            y={mid - 8}
            width={16}
            height={16}
            rx={2}
            fill="none"
            stroke="var(--color-brand-border)"
            strokeWidth={1}
          />
          {square(8, 'var(--color-brand-bright)')}
        </>
      );
    case 'knot':
      // Hollow with a core, so a landing is legible as a different kind of
      // thing from a version without needing a second colour.
      return (
        <>
          <rect
            x={at - 6}
            y={mid - 6}
            width={12}
            height={12}
            rx={2}
            fill="var(--color-background)"
            stroke={MAIN_NODE}
            strokeWidth={WIDTH}
          />
          <rect x={at - 2} y={mid - 2} width={4} height={4} fill={MAIN_NODE} />
        </>
      );
  }
}
