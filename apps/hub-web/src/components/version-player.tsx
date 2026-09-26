import { AlphaTab, darkTheme, usePlayback, useScore } from '@gpt/alphatab-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@gpt/ui/button';
import { Skeleton } from '@gpt/ui/skeleton';
import { versionScoreUrl } from '@/lib/api';

/**
 * A version, rendered and playable in the browser.
 *
 * The design brief said the hub could not do this and made *open it in the
 * app* the only way to hear a version. That was a statement about the hub's
 * dependencies, not about what is possible: `@gpt/alphatab-react` already
 * renders and plays a score for the companion, alphaTab runs perfectly well
 * in an ordinary tab, and the hub can hand out a version's bytes. So the
 * history stops apologising and plays the song.
 *
 * What stays true is the division of labour: this is read-only. Editing,
 * merging and deciding a conflict are still the companion's, and the exit to
 * it is still on the inspector below.
 */

const SETTINGS = {
  ...darkTheme,
  core: { engine: 'svg' as const, logLevel: 'error' as const },
  player: {
    enablePlayer: true,
    enableElementHighlighting: true,
    // Emitted into `public/` by the alphaTab Vite plugin, and the same file
    // the companion plays through — two surfaces, one instrument set.
    soundFont: '/soundfont/sonivox.sf2',
  },
};

export function VersionPlayer({ scoreId, commit }: { scoreId: string; commit: string }) {
  return (
    <AlphaTab.Root
      // A version is a different score, not new props for the same one:
      // remounting keeps the player from inheriting the last one's position.
      key={commit}
      // A URL, not bytes. alphaTab streams it itself, and the response is
      // immutable — a sha names one tree forever — so stepping back through a
      // history re-reads nothing it has already seen.
      src={versionScoreUrl(scoreId, commit)}
      settings={SETTINGS}
    >
      <Stage />
    </AlphaTab.Root>
  );
}

/**
 * Inside `<AlphaTab.Root>`, because whether the file parsed is only knowable
 * here and it has to reset with the version rather than outlive it.
 *
 * The viewport stays mounted in every state, and that is load-bearing rather
 * than tidy. `<Viewport>` registers itself with a ref callback, and
 * unregistering destroys the api, which resets the loading flag — so swapping
 * the viewport out for a skeleton while it loads is an infinite loop:
 * mount, load, hide, destroy, reset, mount. The skeleton and the error go
 * *over* it.
 */
function Stage() {
  const { t } = useTranslation();
  const { isLoading, error } = useScore();

  return (
    <div className="flex min-h-0 flex-1 flex-col border border-border-subtle bg-card">
      <Transport />

      {/* `isolate` contains alphaTab's cursor wrapper, which it hardcodes to
          z-index 1000. Without a stacking context that number lands in the
          root one and paints the beat cursor over the header and dialogs. */}
      <div className="relative isolate min-h-0 flex-1 overflow-auto bg-background">
        <AlphaTab.Viewport />

        {(isLoading || error) && (
          <div className="absolute inset-0 bg-background">
            {error ? (
              <p className="p-3 text-sm leading-normal text-muted-foreground">
                {t('player.unreadable')}
              </p>
            ) : (
              <ScoreSkeleton />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Transport() {
  const { t } = useTranslation();
  const { state, isReadyForPlayback, playPause, stop } = usePlayback();

  return (
    <div className="flex h-9 flex-none items-center gap-2 border-b border-border-subtle px-2">
      <Button
        size="sm"
        variant={state === 'playing' ? 'secondary' : 'default'}
        className="h-6.5 rounded-sm px-2.5 text-sm"
        disabled={!isReadyForPlayback}
        onClick={playPause}
      >
        {state === 'playing' ? t('player.pause') : t('player.play')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6.5 rounded-sm px-2.5 text-sm"
        disabled={state === 'idle'}
        onClick={stop}
      >
        {t('player.stop')}
      </Button>
      {!isReadyForPlayback && (
        // The soundfont is a megabyte and arrives after the notation does.
        // Saying so beats a Play button that silently does nothing.
        <span role="status" className="ml-auto text-xs text-muted-foreground">
          {t('player.loadingSounds')}
        </span>
      )}
    </div>
  );
}

/** Static, like every other skeleton here: hover and active states are the
 * whole motion budget. */
function ScoreSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4" aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex flex-col gap-1.5">
          {[0, 1, 2, 3, 4, 5].map((line) => (
            <Skeleton key={line} className="h-px w-full rounded-none bg-border" />
          ))}
        </div>
      ))}
    </div>
  );
}
