import { useTranslation } from 'react-i18next';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

export interface DiffTrackTab {
  name: string;
  /** Bars this track gained, lost, or had rewritten; 0 renders no chip. */
  changes: number;
}

interface DiffTrackTabsProps {
  tracks: DiffTrackTab[];
  /** Measures the edit touched anywhere in the score — the "All" chip. */
  totalChanges: number;
  /** `null` is the All tab: every instrument rendered, every change highlighted. */
  value: number | null;
  onChange(value: number | null): void;
}

const ALL = 'all';

/**
 * Track picker for the diff toolbar. Every track is visible at once so the
 * chips answer "where did this edit land?" without opening anything, and
 * picking one narrows the panes below to that instrument.
 */
export function DiffTrackTabs({ tracks, totalChanges, value, onChange }: DiffTrackTabsProps) {
  const { t } = useTranslation();
  // With a single instrument "All" is that instrument: no choice to offer.
  if (tracks.length <= 1) return null;

  return (
    <ToggleGroup
      aria-label={t('extended.stage.tracks')}
      value={[value === null ? ALL : String(value)]}
      // Pressing the active item again would clear the group; a diff always
      // has something on screen, so an empty selection is dropped.
      onValueChange={([next]) => {
        if (next !== undefined) onChange(next === ALL ? null : Number(next));
      }}
      spacing={0}
      className="gap-0.5"
    >
      <TrackTab
        value={ALL}
        name={t('extended.stage.allTracks')}
        changes={totalChanges}
      />
      {tracks.map((track, index) => (
        <TrackTab
          key={`${track.name}-${index}`}
          value={String(index)}
          name={track.name}
          changes={track.changes}
        />
      ))}
    </ToggleGroup>
  );
}

function TrackTab({ value, name, changes }: { value: string; name: string; changes: number }) {
  const { t } = useTranslation();

  return (
    <ToggleGroupItem
      value={value}
      size="sm"
      aria-label={
        changes > 0
          ? `${name} — ${t('extended.stage.trackChanges', { count: changes })}`
          : `${name} — ${t('extended.stage.trackUnchanged')}`
      }
      className={cn(
        'h-6 gap-1.5 rounded-sm px-2 font-mono text-[10px] text-muted-foreground',
        'aria-pressed:text-foreground',
      )}
    >
      <span className="max-w-32 truncate">{name}</span>
      {changes > 0 && (
        <span
          aria-hidden
          className="rounded-full bg-diff-changed-bg px-1.5 text-[9px] leading-4 tabular-nums text-diff-changed"
        >
          {changes}
        </span>
      )}
    </ToggleGroupItem>
  );
}
