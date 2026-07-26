import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface TrackSelectorProps {
  tracks: string[];
  /** `null` renders every track — only offered when `allowAll` is set. */
  value: number | null;
  onChange(value: number | null): void;
  allowAll?: boolean;
}

export function TrackSelector({ tracks, value, onChange, allowAll = false }: TrackSelectorProps) {
  const { t } = useTranslation();
  if (tracks.length <= 1 && !allowAll) return null;

  const label = value === null ? t('extended.stage.allTracks') : (tracks[value] ?? '—');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="xs" className="text-muted-foreground" />}
      >
        {label}
        <ChevronDown data-icon="inline-end" className="opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {allowAll && (
          <DropdownMenuItem
            onClick={() => onChange(null)}
            className={cn('text-xs', value === null && 'text-brand-bright')}
          >
            {t('extended.stage.allTracks')}
          </DropdownMenuItem>
        )}
        {tracks.map((name, index) => (
          <DropdownMenuItem
            key={`${name}-${index}`}
            onClick={() => onChange(index)}
            className={cn('text-xs', value === index && 'text-brand-bright')}
          >
            {name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
