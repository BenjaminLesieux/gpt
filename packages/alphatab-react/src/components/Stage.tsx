import type { CSSProperties, ReactNode } from "react";
import { useAlphaTabContext } from "../context/AlphaTabContext";
import { Viewport } from "./Viewport";
import type { CursorClassNames } from "../types/events";

export interface StageProps {
  className?: string;
  /** Shown over the viewport while the score parses. */
  loading?: ReactNode;
  /** Shown over the viewport when the score will not load. */
  failed?: (error: Error) => ReactNode;
  cursorClassNames?: CursorClassNames;
}

// alphaTab puts its cursor at z-index 1000; isolation keeps that inside the stage.
const STAGE_STYLE: CSSProperties = { position: "relative", isolation: "isolate" };
const OVERLAY_STYLE: CSSProperties = { position: "absolute", inset: 0 };

/**
 * The viewport with loading and error content laid over it. The viewport is
 * never swapped out: unmounting it destroys the api, which resets the load,
 * which mounts it again.
 * Must be rendered inside an <AlphaTab.Root>.
 */
export function Stage({ className, loading, failed, cursorClassNames }: StageProps) {
  const { isLoading, error } = useAlphaTabContext();
  const overlay = error ? failed?.(error) : isLoading ? loading : null;

  return (
    <div className={className} style={STAGE_STYLE}>
      <Viewport cursorClassNames={cursorClassNames} />
      {overlay != null && <div style={OVERLAY_STYLE}>{overlay}</div>}
    </div>
  );
}
