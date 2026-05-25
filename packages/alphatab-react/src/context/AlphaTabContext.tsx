import { createContext, use, type ReactNode } from "react";
import type * as alphaTab from "@coderline/alphatab";

export interface AlphaTabContextValue {
  api: alphaTab.AlphaTabApi | null;
  score: alphaTab.model.Score | null;
  isLoading: boolean;
  error: Error | null;
  isReadyForPlayback: boolean;
  /** The real HTMLElement of the mounted <Viewport> div, or null before mount. */
  viewportEl: HTMLElement | null;
  /** Internal — called by <Viewport> when its div mounts/unmounts. */
  _registerViewport: (el: HTMLElement | null) => void;
}

const noop = () => undefined;

export const AlphaTabContext = createContext<AlphaTabContextValue>({
  api: null,
  score: null,
  isLoading: false,
  error: null,
  isReadyForPlayback: false,
  viewportEl: null,
  _registerViewport: noop,
});

export function useAlphaTabContext(): AlphaTabContextValue {
  return use(AlphaTabContext);
}

/** @deprecated Use <AlphaTab.Root> directly. Kept for backward compat only. */
export function AlphaTabProvider({ children }: { children: ReactNode }) {
  return (
    <AlphaTabContext
      value={{ api: null, score: null, isLoading: false, error: null, isReadyForPlayback: false, viewportEl: null, _registerViewport: noop }}
    >
      {children}
    </AlphaTabContext>
  );
}
