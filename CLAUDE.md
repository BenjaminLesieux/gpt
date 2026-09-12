<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

# Frontend: shadcn/ui first — no exceptions

This project's UI is built on **shadcn/ui** + **BaseUI**. Before writing any markup, search the existing shadcn components and pick the one that fits.

- **Always use the shadcn MCP** (`mcp__shadcn__*`) to discover, view, and install components. Do not hand-roll a Button, Card, Tabs, ScrollArea, Tooltip, Empty state, Alert, Skeleton, Separator, Badge, ToggleGroup, Sonner, Spinner, or any other primitive that shadcn ships.
- **Components live in the shared package `packages/ui`**, imported by subpath: `import { Button } from '@gpt/ui/button'`, `import { cn } from '@gpt/ui/lib/utils'`. There is no barrel export — `dialog` and `alert-dialog` export overlapping names. Both `apps/companion` and `apps/hub-web` consume it; neither has its own `components/ui/`.
- **Adding new components**: run the CLI from `packages/ui`, never from an app — `cd packages/ui && pnpm dlx shadcn@latest add @shadcn/<name>` (or use `mcp__shadcn__get_add_command_for_items`). Afterwards rewrite the `@/lib/utils` import the CLI writes into a relative one; `packages/ui/README.md` has the exact sed. Components are themed automatically by `packages/ui/src/styles/theme.css` (Tailwind v4 `@theme inline`) which maps Gitarpro tokens onto shadcn's `--primary`, `--muted`, `--card`, `--accent`, `--destructive`, etc.
- **Theme**: apps do their own `@import 'tailwindcss'` and then `@import '@gpt/ui/theme.css'`. `theme.css` does not import Tailwind itself, so importing it twice is safe. Raw values live in `packages/ui/src/styles/tokens.css`.
- **Custom styling**: stay in shadcn-provided color slots — `bg-background`, `text-foreground`, `text-muted-foreground`, `bg-card`, `bg-accent`, `border-border`, `text-destructive`. Don't reach for legacy tokens like `text-fg-meta`, `border-border-subtle`, `text-fg-muted`. The Bauhaus look is the theme, not the markup.
- **`var(--color-accent)` means two different things.** In raw CSS it is the brand red from `tokens.css`; only the `@theme inline` utilities carry shadcn's hover-surface meaning. Name the token you actually want.
- **Variant naming follows shadcn**: `variant="default" | "destructive" | "outline" | "secondary" | "ghost" | "link"`. Do not invent `primary`/`subtle`/`danger` variants on top of shadcn components.
- **Fonts are per-app.** The licensed Bauhaus family is vendored in the companion only (`apps/companion/src/styles/fonts.css`); the hub is a public web surface and substitutes Space Grotesk. `--font-sans` is overridden in `apps/hub-web/src/styles.css`.
- **Wrappers**: `ExtendedApp.tsx` already provides `TooltipProvider`. Use it; don't nest extra providers. The panel deliberately has none — it is a 420×320 card with a latency budget.
- **Two window surfaces in the companion, not one page.** The panel (`src/panel/`) is frameless, transparent and always-on-top; the extended window (`src/extended/`) is a normal decorated window. They are separate Vite inputs with separate entry HTML, and a component that assumes one will not fit the other.

When in doubt: open `packages/ui/src/components/ui/` to see what's already installed. If it's not there, install it via shadcn — never re-implement.
