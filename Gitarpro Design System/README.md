# Gitarpro Design System

**Gitarpro** ("gpt") is *git for musicians* — a version control system built specifically for Guitar Pro (`.gp`, `.gp5`, `.gpx`) files. It brings familiar git concepts (init, add, commit, diff, branch, merge) to tablature and sheet music, letting musicians version-control their compositions.

---

## Products

| Product | Description | Path |
|---|---|---|
| **CLI** (`gpt`) | Terminal tool — `gpt init`, `gpt add`, `gpt commit`, `gpt diff`, `gpt log`, `gpt show`, `gpt status` | `gpt/apps/cli` |
| **Desktop App** | Electron + React app — history browser, tab viewer, commit panel, diff view, merge conflict resolver | `gpt/apps/desktop` |

**Core packages:**
- `@gpt/gpt-core` — types, diff algorithm, serializer (`gpt/packages/gpt-core`)
- `@gpt/alphatab-react` — React wrapper for AlphaTab tablature rendering (`gpt/packages/alphatab-react`)

**Sources provided:**
- Codebase: `gpt/` (mounted via File System Access API — read-only)

---

## CONTENT FUNDAMENTALS

**Tone:** Precise, technical, musician-friendly. The copy talks like a senior developer who also plays guitar — no fluff, no marketing speak. It uses the vocabulary of both git and music naturally.

**Voice:** First-person ("your repo", "your commits", "your tabs"). Direct imperative commands. Short, declarative sentences.

**Casing:**
- UI labels: Sentence case ("Commit message", "Stage file")
- CLI commands: lowercase verbatim (`gpt commit -m "init"`)
- Branch/hash displays: monospace, full or short hash as appropriate
- Filenames: literal (e.g. `song.gp`)

**Emoji:** Never used. The product is professional tooling.

**Writing style:**
- Commit messages are git-style: imperative, lowercase, no period. ("add intro riff", "fix bridge timing")
- Diff summaries are concise: "3 bars changed in Lead Guitar, 1 bar added in Bass"
- Error messages are plain English with no stack traces surfaced to the user
- Empty states are minimal: "Nothing to commit, working tree clean"
- Status labels match git conventions: `staged`, `modified`, `deleted`, `untracked`

**Examples from codebase:**
- `"Nothing to commit, working tree clean"`
- `"Changes staged for commit:"`
- `"Changes not staged for commit:"`
- `"On branch main"`

---

## VISUAL FOUNDATIONS

### Philosophy
Bauhaus-dark. The interface is a precision instrument — functional, grid-aligned, zero decoration. Influenced by the cold minimalism of Interpol's *Turn On the Bright Lights*: near-black fields, cold grey typography, single controlled accent.

### Color System
- **Background:** `#0c0c0c` — near-black, not pure black (avoids harshness)
- **Surface:** `#141414` — panels, sidebars
- **Surface Raised:** `#1c1c1c` — cards, hover targets
- **Border:** `#2a2a2a` — structural dividers (subtle)
- **Foreground 1:** `#f0f0f0` — primary text (slightly warm white)
- **Foreground 2:** `#8a8a8a` — secondary labels, metadata
- **Foreground 3:** `#484848` — muted/disabled, placeholders
- **Accent:** `oklch(55% 0.16 22)` — cold brick-red; used sparingly for active states, destructive actions, highlights
- **Added:** `oklch(58% 0.13 145)` — cold green for diff additions
- **Removed:** same as accent (cold red) for diff removals
- **Changed:** `oklch(65% 0.14 60)` — amber for diff modifications

### Typography
- **Display / Headings:** "Space Grotesk" (Google Fonts) — geometric, Bauhaus-adjacent
- **Body / UI:** "Space Grotesk" — same family, weight variation
- **Monospace:** "Space Mono" — for hashes, file paths, CLI output, tablature metadata
- **Substitution note:** No custom fonts found in codebase — Google Fonts substitutes used

### Spacing & Layout
- Base unit: `4px`. Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96
- Layout: fixed left sidebar (~220px) + main content area. Electron window chrome handled by OS.
- Grid: 12-col internally; most panels use 2-3 col splits
- Dense information display — list rows are 36–44px tall

### Corner Radii
- Default: `2px` — near-sharp, Bauhaus-appropriate
- Chips/badges: `2px`
- Modals/dialogs: `4px`
- No pill shapes; no large rounded corners

### Borders & Surfaces
- Borders are always `1px solid var(--border)` — no double borders, no shadows for separation
- Cards have no drop shadow — they are defined by their background color alone
- Subtle inner separation via background color contrast

### Shadows & Elevation
- No box-shadows for decoration
- Only functional shadows: focused input `0 0 0 2px var(--accent)` outline
- Overlays/modals: `0 8px 32px rgba(0,0,0,0.6)` (dark rooms need darker shadows)

### Animation
- Minimal: 100–150ms ease transitions on hover/active states
- No bounces, no springs, no page transitions
- Color fades on hover: `transition: background 100ms ease, color 100ms ease`
- No loading spinners — use skeleton states where needed

### Hover/Active States
- Hover: background lightens by one step (e.g. surface → surface-raised)
- Active/press: slight opacity reduction (0.8) on icons; background one more step lighter
- Selected list items: left `2px` accent border + surface-raised background

### Iconography
See ICONOGRAPHY section below.

### Imagery
- No photography. No illustrations.
- The tablature render (via AlphaTab) IS the hero visual — treat it as primary content
- Diff highlights (green/red/amber overlays on bars) are the main visual language for state

### Use of Transparency/Blur
- Backdrop blur: never (too trendy, too expensive)
- Transparency: only for disabled states (50% opacity) and overlay backdrops (rgba black)

---

## ICONOGRAPHY

The codebase contains no icon font, no SVG icon library, and no custom icons — the desktop app is pre-UI. Icons should come from **Lucide Icons** (CDN: `https://unpkg.com/lucide@latest`), which matches the desired aesthetic: 1.5px stroke, geometric, clean.

**Usage pattern:**
```html
<i data-lucide="git-commit"></i>
<script>lucide.createIcons();</script>
```

**Key icons in use:**
- `git-commit` — commits
- `git-branch` — branches
- `git-merge` — merge
- `git-compare` — diff view
- `history` — commit log
- `music` — score/tab viewer
- `file-plus` — stage file
- `check` — confirm/resolve
- `x` — close/cancel
- `folder-open` — open repo
- `chevron-right`, `chevron-down` — tree expansion
- `play`, `pause`, `square` — playback

**Note:** No custom logo found in the codebase. A text-based logotype is used ("gpt" in Space Mono, monospace, with the accent color on the `t`).

---

## Files

| File / Folder | Description |
|---|---|
| `README.md` | This file — product overview, content + visual foundations |
| `colors_and_type.css` | CSS custom properties for all design tokens |
| `SKILL.md` | Agent skill definition for Claude Code / other agents |
| `preview/colors-base.html` | Base color palette swatches |
| `preview/colors-diff.html` | Diff & status semantic color swatches |
| `preview/type-scale.html` | Space Grotesk type scale specimen |
| `preview/type-mono.html` | Space Mono / CLI output specimen |
| `preview/spacing-tokens.html` | Spacing scale (4px base unit) |
| `preview/spacing-radius-shadow.html` | Border radii, shadows, border styles |
| `preview/components-buttons.html` | Button variants — primary, secondary, ghost, danger |
| `preview/components-badges.html` | Diff badges, branch tags, file-status badges |
| `preview/components-inputs.html` | Text inputs, textarea, labels |
| `preview/components-list.html` | Commit list rows with hash/message/timestamp |
| `preview/components-status-panel.html` | Staged / unstaged / untracked panels |
| `preview/components-diff-bars.html` | Per-bar diff visualization grid |
| `preview/brand-logotype.html` | gpt wordmark — sizes and usage |
| `ui_kits/desktop/index.html` | **Desktop app UI kit** — interactive prototype |
| `ui_kits/desktop/Sidebar.jsx` | Sidebar, nav, branch selector component |
| `ui_kits/desktop/Views.jsx` | History, Status, Diff, Merge, OpenRepo views |
| `ui_kits/desktop/README.md` | Desktop UI kit notes |
