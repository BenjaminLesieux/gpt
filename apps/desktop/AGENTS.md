# @gpt/desktop

## Purpose

The Electron-based desktop application. It is a **thin UI wrapper** around the CLI — it contains zero business logic. Every action (commit, diff, log) is performed by invoking the CLI and rendering the JSON response.

If you find yourself writing business logic in the desktop (parsing .gp files, computing diffs, touching git), **stop** — that logic belongs in `apps/cli` or `packages/gpt-core`.

## Architecture

```
electron/
  main/index.ts    — Electron main process: creates BrowserWindow, registers IPC handlers
  preload/index.ts — contextBridge: exposes window.gptBridge to renderer
  bridge.ts        — CLIBridge: spawns gpt CLI or connects to gpt serve

src/
  main.tsx         — React entrypoint (QueryClientProvider, renders <App>)
  app/app.tsx      — Root component, routing
  store/index.ts   — Zustand store (3 slices: repo, history, viewer)
  hooks/
    useGpt.ts      — TanStack Query hooks: useCommitLog, useRepoStatus, useShow, useShowFile,
                     useStageFile, useCommit, useInitRepo, useValidateRepo
  features/
    history/       — HistoryBrowser (commit list) + CommitDetail + TabViewer
    status/        — StatusPanel (file list) + StatusTabViewer (HEAD preview)
    diff/          — Side-by-side diff view (two <TabScore> + highlighted measures) [M4.3]
    merge/         — Per-measure conflict resolution UI [M5.3]
  components/
    chrome/        — TitleBar (macOS drag region)
    history/       — CommitRow, HistoryHeader, HistorySkeleton, HistoryEmptyState, HistoryErrorState
    commit-detail/ — CommitEmptyState, CommitMetaRow
    tab-viewer/    — FileTabs, TrackSelector, PlayTimeline, TabViewerLoadingState, TabViewerErrorState, NoFilesState
    status/        — StatusHeader, StatusFileRow, StatusSection, StatusSkeleton,
                     StatusEmptyState, StatusErrorState, StatusSelectFileState, StatusNewFileState
    open-repo/     — IdleScreen, BusyScreen, NeedsInitScreen, OpenRepoErrorScreen, OpenRepoHeader, OpenRepoFooter
    repo-shell/    — RepoCard
    ui/            — shadcn/ui components (copied source, not a dependency)
  views/
    OpenRepoView   — Landing screen: open or init a repo
    RepoShell      — Sidebar nav shell wrapping all repo views
    HistoryView    — Split: HistoryBrowser (280px) | CommitDetail + TabViewer
    StatusView     — Split: StatusPanel (280px) | StatusTabViewer (HEAD preview of selected file)
```

## Status view layout

`StatusView` mirrors the JetBrains Git panel layout:

```
[ StatusPanel (280px, scrollable file list) | StatusTabViewer (flex-1, tab preview) ]
```

- **File list** (`StatusPanel`): staged section + unstaged section, each file is a clickable row with a colored `[A/M/D/?]` badge. Selection is held in local React state in `StatusView` (not Zustand — it's purely view-local).
- **Tab preview** (`StatusTabViewer`): lazy-loaded (same pattern as `CommitDetail → TabViewer`). Shows the selected file at HEAD via `useShowFile(repoPath, commits[0].hash, file)`. Uses TanStack Query cache — if the file was already loaded in the history view it costs zero extra requests.
  - `added` / `untracked` files → `StatusNewFileState` (no HEAD version exists)
  - `modified` / `deleted` files → full AlphaTab viewer + playback controls
  - Nothing selected → `StatusSelectFileState`

## IPC protocol

All communication with the CLI goes through `window.gptBridge.run(command, args)`:

```typescript
// In renderer
const commits = await window.gptBridge.run("log", ["--json"]);

// The bridge calls: gpt log --json
// Returns: { ok: true, data: Commit[] } | { ok: false, error: {...} }
```

Never call `window.require`, `ipcRenderer`, or Node APIs in the renderer. Always go through `window.gptBridge` (contextBridge).

## State management

Zustand store has three slices:

| Slice | What it holds |
|---|---|
| `repo` | current repo path, branch, file status |
| `history` | commit list, selected commit hash, branches |
| `viewer` | left/right score buffers, active track, diff mode |

TanStack Query owns all async/server state (CLI responses). Zustand owns all UI state. Never duplicate CLI response data into Zustand.

## Adding a new feature

1. Create a directory under `src/features/<name>/`
2. Add a TanStack Query hook in `src/hooks/useCLI.ts` for any new CLI call needed
3. Add a Zustand action only if UI state is needed (not for data)
4. Wire the feature into the router in `src/app/app.tsx`

## UI conventions

- **shadcn/ui is the default UI kit.** Before writing any markup, look in `src/components/ui/` for an existing primitive; if missing, install it with `pnpm dlx shadcn@latest add @shadcn/<name>` (or via the shadcn MCP). Never hand-roll Button/Card/Tabs/ScrollArea/Tooltip/Empty/Alert/Skeleton/Separator/Badge/ToggleGroup/Sonner/Spinner/Dialog.
- **Imports use the `@/` alias** (e.g. `import { Button } from "@/components/ui/button"`). Configured in `tsconfig.app.json`, `vite.config.mts`, and `electron.vite.config.ts`.
- **Theme via `src/styles/app.css` only.** Tailwind v4 `@theme inline` already maps Gitarpro tokens onto shadcn's color slots (`--primary`, `--muted`, `--accent`, `--card`, `--destructive`, `--border`, etc.). Tweak tokens, not component internals.
- **Use shadcn variant names verbatim** (`default | destructive | outline | secondary | ghost | link`). Use shadcn color classes (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `text-destructive`) — the legacy `text-fg-meta` / `border-border-subtle` / `text-fg-muted` tokens are removed.
- **Title bar.** macOS uses `titleBarStyle: "hiddenInset"` (see `electron/main/index.ts`). The `<TitleBar>` in `src/components/chrome/TitleBar.tsx` reserves space for the traffic lights and serves as the drag region. The layout in `app/app.tsx` mounts it once at the top; views must use `h-full min-h-0` (never `h-screen`) so they fit underneath.
- **App-level providers** (`TooltipProvider`, `<Toaster />`) are mounted in `app/app.tsx`. Don't nest duplicate providers.
- Use the `frontend-design` and React skills when designing or refactoring UI.
- Musical UX language: say "snapshot" not "commit", "version" not "branch", "combine" not "merge" — in UI labels and copy only. Internal code and props use Git terminology.

## Testing

```bash
pnpm nx test @gpt/desktop
pnpm nx e2e @gpt/desktop-e2e
```

Unit tests: mock `window.gptBridge` with `vi.stubGlobal`. Test components in isolation — never spawn a real Electron process.
E2E tests (Playwright): test the full app flow end-to-end.

Test naming: **`should <action> when <condition>`**
Structure: Given / When / Then inside each test.

Only write tests for components with real logic. Do not test placeholder/skeleton components.
