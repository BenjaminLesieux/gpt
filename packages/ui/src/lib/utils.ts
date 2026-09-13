/**
 * `cn` is shadcn's own compiled replacement for `twMerge(clsx(...))` — one
 * zero-dependency package in place of the two this file used to compose, and
 * what the registry's newer components import directly.
 *
 * Re-exported rather than swapped at 24 call sites: `@gpt/ui/lib/utils` is the
 * path every component, both apps and CLAUDE.md all name, so the
 * implementation moves and nothing else has to.
 */
export { cn } from 'cn';
export type { ClassValue } from 'cn';
