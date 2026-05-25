import type * as alphaTab from "@coderline/alphatab";
import { useAlphaTabContext } from "../context/AlphaTabContext";

export interface UseAlphaTabApiResult {
  /** The raw AlphaTabApi instance. Null until <AlphaTab.Viewport> mounts. */
  api: alphaTab.AlphaTabApi | null;
}

/** Escape hatch — direct access to the AlphaTabApi. Must be inside <AlphaTab.Root>. */
export function useAlphaTabApi(): UseAlphaTabApiResult {
  const { api } = useAlphaTabContext();
  return { api };
}
