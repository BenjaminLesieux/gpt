/** Converts a ConflictLocation.path string to a compact human-readable label. */
export function humanPath(path: string): string {
  return path
    .replace(/^score\./, '')
    .replace(/^masterBar\[(\d+)\]\./, (_: string, n: string) => `Bar ${+n + 1} · `)
    .replace(/^track\[(\d+)\]\./, (_: string, n: string) => `Track ${+n + 1} · `)
    .replace(/\.bar\[(\d+)\]/, (_: string, n: string) => ` · Bar ${+n + 1}`)
    .replace(/\.voice\[(\d+)\]/, (_: string, n: string) => ` · Voice ${+n + 1}`)
    .replace(/\.beat\[(\d+)\]/, (_: string, n: string) => ` · Beat ${+n + 1}`)
    .replace(/\.note\[s=(\d+)\]/, (_: string, n: string) => ` · String ${+n + 1}`)
    .replace(/\.structuralBeats$/, ' · Beat structure')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c: string) => c.toUpperCase())
    .trim();
}

/** Returns the first segment of a conflict path (e.g. "track[0].bar[4].…" → "Bar 5"). */
export function pathBarLabel(path: string): string {
  const barMatch = /\.bar\[(\d+)\]/.exec(path);
  return barMatch ? `Bar ${+barMatch[1] + 1}` : '';
}
