import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TitleBarProps {
  children?: ReactNode;
  className?: string;
}

// Reserves space for macOS' hiddenInset traffic lights (top-left) and
// makes the strip itself act as the OS drag handle.
export function TitleBar({ children, className }: TitleBarProps) {
  return (
    <div
      style={{ WebkitAppRegion: "drag" }}
      className={cn(
        "flex h-8 shrink-0 select-none items-center justify-end gap-2 border-b border-border/60 bg-background/80 pl-20 pr-3 backdrop-blur",
        className,
      )}
    >
      <div style={{ WebkitAppRegion: "no-drag" }} className="flex items-center gap-2">
        {children}
      </div>
    </div>
  );
}
