import type * as alphaTab from '@coderline/alphatab';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { getInstrumentIcon } from '@/lib/utils';

interface TrackSelectorProps {
  score: alphaTab.model.Score;
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
}

const ALL = '__all__';

export function TrackSelector({
  score,
  selectedIndex,
  onSelect,
}: TrackSelectorProps) {
  if (score.tracks.length <= 1) return null;

  return (
    <div className="flex shrink-0 items-center gap-3 overflow-x-auto border-b border-border px-4 py-2.5">
      <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        Track
      </span>
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={4}
        value={[selectedIndex === null ? ALL : String(selectedIndex)]}
        aria-label="Track selector"
        onValueChange={(next) => {
          if (!next.length) return;
          const selected = next[0];
          onSelect(selected === ALL ? null : Number(selected));
        }}
      >
        <ToggleGroupItem value={ALL}>All</ToggleGroupItem>
        {score.tracks.map((track, i) => {
          const Icon = getInstrumentIcon(track);
          return (
            <ToggleGroupItem
              key={`${track.name}-${track.index}` || `track-${i}`}
              value={String(i)}
              className="gap-1.5"
            >
              <Icon className="size-3.5 shrink-0" />
              {track.name ?? `Track ${i + 1}`}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
}
