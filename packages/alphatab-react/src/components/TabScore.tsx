import { Root, type RootProps } from "./Root";
import { Viewport } from "./Viewport";

export interface TabScoreProps extends Omit<RootProps, "children"> {
  /** className forwarded to the Viewport div. */
  className?: string;
  /** style forwarded to the Viewport div. */
  style?: React.CSSProperties;
}

/**
 * Convenience wrapper — renders a complete AlphaTab score in a single element.
 * For custom layouts (controls, track mixers, etc.) compose <AlphaTab.Root> +
 * <AlphaTab.Viewport> directly.
 */
export function TabScore({ className, style, ...rootProps }: TabScoreProps) {
  return (
    <Root {...rootProps}>
      <Viewport className={className} style={style} />
    </Root>
  );
}
