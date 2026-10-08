import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@gpt/ui/command';
import { listBranches } from '@/lib/ipc';
import { PanelBody } from './PanelShell';

/**
 * Pick the branch the active file commits to, or type a name to start one.
 * Remote branches are listed as of the last fetch.
 */
export function BranchSwitcher({
  fileId,
  current,
  onSelect,
  onError,
}: {
  fileId: string;
  current: string;
  onSelect(branch: string): void;
  onError(message: string): void;
}) {
  const { t } = useTranslation();
  const [branches, setBranches] = useState<string[]>([current]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void listBranches(fileId)
      .then((names) => !cancelled && setBranches(names))
      .catch((cause) => !cancelled && onError(String(cause)));
    return () => {
      cancelled = true;
    };
  }, [fileId, onError]);

  const name = query.trim();
  const isNew = name.length > 0 && !branches.includes(name);

  return (
    <PanelBody data-panel-stagger="">
      <Command loop label={t('panel.switchBranch')} className="min-h-0 flex-1 bg-transparent p-0">
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('panel.searchBranches')}
          autoFocus
          className="text-sm"
        />
        <CommandList className="max-h-none min-h-0 flex-1 p-0">
          <CommandGroup className="p-0">
            {branches.map((branch) => (
              <CommandItem
                key={branch}
                value={branch}
                onSelect={() => onSelect(branch)}
                className="gap-2.5 rounded-none px-3 py-1.5"
              >
                <span
                  aria-hidden
                  className={
                    branch === current
                      ? 'h-3.5 w-[3px] shrink-0 bg-brand'
                      : 'h-3.5 w-[3px] shrink-0 bg-transparent'
                  }
                />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{branch}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          {isNew && (
            <>
              <CommandSeparator className="mx-0 my-1" />
              <CommandGroup className="p-0">
                <CommandItem
                  forceMount
                  value={`__start__ ${name}`}
                  onSelect={() => onSelect(name)}
                  className="gap-2.5 rounded-none px-3 py-1.5 text-xs"
                >
                  <Plus className="size-3.5 text-brand-bright" />
                  {t('panel.startBranch', { name })}
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </PanelBody>
  );
}
