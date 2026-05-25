import { useCallback } from "react";
import { toast } from "sonner";

/**
 * Returns a stable async callback that opens a file path with the OS default
 * application (Guitar Pro on macOS/Windows, xdg-open on Linux).
 * Shows a sonner error toast if the shell reports a failure.
 */
export function useOpenFile() {
  return useCallback(async (filePath: string) => {
    if (!window.gptNative) return;
    const err = await window.gptNative.openPath(filePath);
    if (err) toast.error("Could not open file", { description: err });
  }, []);
}
