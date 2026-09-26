# Shared score surfaces

The detail behind [ADR 0010](adr/0010-the-companion-and-the-hub-draw-a-score-from-the-same-components.md).
Read the ADR first: it carries the decision, this carries the parts list.

## The rule

For every piece both apps draw, **the more complete copy moves and the other is
deleted.** If the loser had something the winner lacked, the winner gains it as
an option; it does not survive as a second component.

## Where things go

| Where | What |
|---|---|
| `@gpt/alphatab-react` | `AlphaTab.Stage`, `useSeek` — unstyled, no copy |
| `@gpt/ui/score/player` | `ScorePlayer`, `TrackSelector` |
| `@gpt/ui/score/history` | `HistoryList`, `HistorySkeleton`, `LoadMore`, `HistoryVersion`, `VersionScope`, `initials`, `shortId`, `scopeText` |
| `@gpt/ui/lib/time` | every date and duration either app prints |

`packages/ui/src/components/score/` holds the two component files, next to —
not inside — `components/ui/`, which stays the shadcn CLI's. The package's
`exports` gains `./score/*` and `./lib/time`. `theme.css` already has
`@source '../components'`, so Tailwind sees the new classes in both apps with
no change to either.

`packages/ui/package.json` gains `@gpt/alphatab-react` and `lucide-react` is
already there. `packages/ui/README.md` changes its first paragraph to say the
package holds product components too.

## Unstyled: `@gpt/alphatab-react`

**`AlphaTab.Stage`** replaces the `<div className="relative isolate …">`
wrapper both players write by hand.

```tsx
<AlphaTab.Stage
  className="min-h-0 flex-1 overflow-auto bg-background"
  loading={<Skeleton />}
  failed={(error) => <Message />}
/>
```

- Always renders `<AlphaTab.Viewport>`; never swaps it out.
- `position: relative; isolation: isolate` as inline style, because they are
  behaviour, not look — a consumer's `className` cannot forget them.
- Renders `loading` over the viewport while the score parses and `failed` over
  it when it will not; neither by default.
- Passes `cursorClassNames` through to the viewport.

**`useSeek()`** is the scrub logic from the companion's `PlaybackBar`:

```ts
const { value, onValueChange, onValueCommitted, disabled } = useSeek();
```

`value` is 0–100 and follows the pointer while dragging, the player otherwise.
Shaped to drop straight onto a slider without knowing it is shadcn's.

Both get specs in the package's own style (`should … when …`, alphaTab mocked).

## Styled: `@gpt/ui/score/player`

`ScorePlayer` is the companion's stage content, `PlaybackBar` and
`TrackSelector`, on `AlphaTab.Stage` and `useSeek`, with the hub's skeleton as
the `loading` content.

```tsx
<ScorePlayer src={urlOrBytes} identity={versionId} labels={labels} />
```

- `src: string | Uint8Array` — the hub passes `versionScoreUrl(...)`, the
  companion passes bytes from `useVersionBytes`.
- `identity` keys the `AlphaTab.Root`, so a new version remounts rather than
  inheriting the last one's position.
- `labels`: `play`, `pause`, `stop`, `position`, `loop`, `speed`, `allTracks`,
  `failed`. Each app fills them from its own `t()`.
- Loading the bytes stays outside. The companion keeps its spinner and error
  around the player; the hub keeps its `Suspense` fallback for the alphaTab
  chunk.

Deleted: `hub-web/src/components/version-player.tsx`,
`companion/src/extended/{PlaybackBar,TrackSelector}.tsx`. `ScoreStage` shrinks
to the byte loading.

## Time: `@gpt/ui/lib/time`

| Today | Becomes |
|---|---|
| companion `formatRelative(unixSeconds, locale)` — narrow, localized | `formatRelative(date, locale)`; also replaces the hub's hand-built `ago()` (`20m`) |
| hub `since(iso)` — *21 minutes ago*, English | `since(date, locale)` |
| hub `until(iso)` — *in 6 days* | `until(date, locale)` |
| hub `dayLabel`, `time` | `dayLabel(date, locale)`, `clock(date, locale)` |
| hub `when` — *Yesterday at 9:31 pm* | gone: the *at* is copy, so the hub's locale file joins `dayLabel` and `clock` |
| hub `LOCALE = 'en-GB'` | `dateLocale(language)` — `en` → `en-GB`, so English stays day-first |

*Today* and *Yesterday* come from `Intl.RelativeTimeFormat(…, { numeric: 'auto' })`,
capitalised — no copy. English keeps the design's *9:31 pm*; other languages
use their own clock.

Everything takes a `Date`. The companion converts its unix seconds once, at the
IPC boundary. `time.spec.ts` and the date cases of `history-format.spec.ts`
move with it.

## Styled: `@gpt/ui/score/history`

`HistoryList` is the hub's, generalised on four axes.

**The version type** — the hub's `Version`, with what only the hub knows made
optional:

```ts
interface HistoryVersion {
  id: string;
  message: string;
  at: string;                  // ISO
  parents: string[];
  authorEmail?: string;        // no author square when absent
  scope?: VersionScope | null; // no scope column when absent
}
```

The hub's API type satisfies it as is, and `VersionScope` moves here with the
hub's `api.ts` importing it. The companion maps its `Version`, deriving
`parents` from list order — its named line is linear until #17.

**Layout** — `@container` on the list, `@min-[800px]:` on its columns in place
of `wide:`. The wide layout then means *this list is at least 800px wide*
rather than *the window is*; in the companion's 304px rail it is always the
narrow one. The hub's `--breakpoint-wide` stays for its own page chrome.

**Copy** — `labels`: `unnamed`, `current`, `landed`, `reading`, and
`session({ part, count, from, to })` for the *Evening session · 11 versions
between 9 and 11 pm* line, whose plural and word order are the app's.
`LoadMore` takes its own two.

**Companion features the hub lacks**, as options:

- `base?: string | null` — the pinned compare base, drawn with the
  `diff-removed` left edge the companion uses today.
- `trailing?(version): ReactNode` — rendered beside the row's button, not
  inside it (a button in a button), which is where the compare pin goes.

Moved from `hub-web`: `lib/lanes.ts`, `lib/history-format.ts` (minus what went
to `time`), `components/history-list.tsx`, `components/history-gutter.tsx`, and
their specs.

The companion's `Timeline` keeps what is its own — the two tiers, the
collapsible recovery section, the compare wiring — and draws both tiers' rows
with `HistoryList`. The snapshot tier passes `unnamed: t('…autoSnapshot')`.

## The hub's i18n

`apps/hub-web/src/lib/i18n.ts`, the companion's file with the hub's resources:
`i18next`, `react-i18next`, `i18next-browser-languagedetector`, `localStorage`
then `navigator`, fallback `en`, `<html lang>` kept in step. Imported first in
`main.tsx`.

`src/locales/{en,fr}.json`, keys grouped by screen (`auth.*`, `scores.*`,
`score.*`, `invite.*`, `join.*`, `credentials.*`). Plurals through i18next's
`_one` / `_other`, replacing the ternaries. Every visible string, `aria-label`
and `sr-only` text moves; the specs that match on English text keep matching,
because tests run in `en`.

## Staying where it is

- **Companion:** panel, `SyncBar`, `FileSelector`, `StageHeader`, `DiffStage`,
  `DiffTrackTabs`, all dialogs, `useHistory`, `useVersionBytes`.
- **Hub:** routes, `VersionInspector` (its facts are the hub's), invite and
  avatar components, `copy-button`, the API client and queries.

## Order

One commit and one issue each; each leaves both apps working.

1. **[#25](https://github.com/BenjaminLesieux/gpt/issues/25) `feat(hub-web): speak french`** — the hub on i18next, `en.json` and
   `fr.json`, dates following the language.
2. **[#26](https://github.com/BenjaminLesieux/gpt/issues/26) `feat(alphatab-react): a stage that stays mounted`** — `AlphaTab.Stage`
   and `useSeek`; both existing players move onto them with no visible change.
3. **[#27](https://github.com/BenjaminLesieux/gpt/issues/27) `refactor(ui): one way to say when`** — `@gpt/ui/lib/time`; the
   companion's `lib/time.ts` and the hub's `relative-time.ts` go.
4. **[#28](https://github.com/BenjaminLesieux/gpt/issues/28) `feat(hub-web): the whole player in the inspector`** —
   `@gpt/ui/score/player`; the hub gains tracks, scrubbing, loop and speed.
5. **[#29](https://github.com/BenjaminLesieux/gpt/issues/29) `feat(companion): the hub's history in the timeline`** —
   `@gpt/ui/score/history`; the companion gains day and session grouping and
   the rail #17 will need.

## The gate

`pnpm nx run-many -t typecheck test -p hub-web @gpt/companion @gpt/ui @gpt/alphatab-react`
after every step. `@gpt/ui` has no test target today; step 3 adds a
`vite.config.mts` for it the way `packages/alphatab-react` has one.
