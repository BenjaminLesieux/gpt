import type { AlphaTabSettings } from "../types/events";

/**
 * AlphaTab settings preset for dark backgrounds.
 * Pass as the `settings` prop on <AlphaTab.Root> or <TabScore>.
 *
 * Colours map to the Gitarpro design-system palette:
 *   fg-1   #f0f0f0  main notation
 *   fg-2   #8a8a8a  secondary / bar numbers
 *   border #2a2a2a  staff lines / bar separators
 */
export const darkTheme = {
  display: {
    resources: {
      mainGlyphColor: "#f0f0f0",
      secondaryGlyphColor: "#8a8a8a",
      scoreInfoColor: "#f0f0f0",
      barSeparatorColor: "#3a3a3a",
      staffLineColor: "#2a2a2a",
      barNumberColor: "#8a8a8a",
    },
  },
} satisfies AlphaTabSettings;

export const lightTheme = {
  display: {
    resources: {
      mainGlyphColor: "#1a1a1a",
      secondaryGlyphColor: "#666666",
      scoreInfoColor: "#1a1a1a",
      barSeparatorColor: "#222211",
      staffLineColor: "#a5a5a5",
      barNumberColor: "#c80000",
    },
  },
} satisfies AlphaTabSettings;
