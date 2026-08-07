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
- **Components live at `apps/companion/src/components/ui/`** with imports via `@/...` (configured in `apps/companion/tsconfig.app.json` + the vite alias). The shadcn config is `apps/companion/components.json`.
- **Adding new components**: from `apps/companion/`, run `pnpm dlx shadcn@latest add @shadcn/<name>` (or use `mcp__shadcn__get_add_command_for_items`). After install, the components are themed automatically via `apps/companion/src/styles/app.css` (Tailwind v4 `@theme inline`) which maps Gitarpro tokens onto shadcn's `--primary`, `--muted`, `--card`, `--accent`, `--destructive`, etc.
- **Custom styling**: stay in shadcn-provided color slots — `bg-background`, `text-foreground`, `text-muted-foreground`, `bg-card`, `bg-accent`, `border-border`, `text-destructive`. Don't reach for legacy tokens like `text-fg-meta`, `border-border-subtle`, `text-fg-muted`. The Bauhaus look is the theme, not the markup.
- **`var(--color-accent)` means two different things.** In raw CSS it is the brand red from `tokens.css`; only the `@theme inline` utilities carry shadcn's hover-surface meaning. Name the token you actually want.
- **Variant naming follows shadcn**: `variant="default" | "destructive" | "outline" | "secondary" | "ghost" | "link"`. Do not invent `primary`/`subtle`/`danger` variants on top of shadcn components.
- **Wrappers**: `ExtendedApp.tsx` already provides `TooltipProvider`. Use it; don't nest extra providers. The panel deliberately has none — it is a 420×320 card with a latency budget.
- **Two window surfaces, not one page.** The panel (`src/panel/`) is frameless, transparent and always-on-top; the extended window (`src/extended/`) is a normal decorated window. They are separate Vite inputs with separate entry HTML, and a component that assumes one will not fit the other.

When in doubt: open `apps/companion/src/components/ui/` to see what's already installed. If it's not there, install it via shadcn — never re-implement.
