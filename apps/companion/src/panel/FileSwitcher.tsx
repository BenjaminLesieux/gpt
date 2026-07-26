import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import type { TrackedFile } from '@/lib/ipc';
import { PanelBody } from './PanelShell';

/**
 * Switch which tracked file the panel commits, or add another one.
 *
 * Filtering matches the folder as well as the name — two songs called
 * `demo.gp` in different projects are otherwise indistinguishable. Rows stay
 * one line high so the whole list fits without scrolling.
 */
export function FileSwitcher({
  files,
  activeId,
  onSelect,
  onAddFile,
}: {
  files: TrackedFile[];
  activeId: string | null;
  onSelect(id: string): void;
  onAddFile(): void;
}) {
  const { t } = useTranslation();

  return (
    <PanelBody data-panel-stagger="">
      <Command loop label={t('panel.switchFile')} className="min-h-0 flex-1 bg-transparent p-0">
        <CommandInput placeholder={t('panel.searchFiles')} autoFocus className="text-sm" />
        <CommandList className="max-h-none min-h-0 flex-1 p-0">
          <CommandEmpty className="py-6 text-xs text-muted-foreground">
            {t('panel.noMatchingFile')}
          </CommandEmpty>

          <CommandGroup className="p-0">
            {files.map((file) => (
              <CommandItem
                key={file.id}
                value={`${file.name} ${file.path}`}
                onSelect={() => onSelect(file.id)}
                className="gap-2.5 rounded-none px-3 py-1.5"
              >
                <span
                  aria-hidden
                  className={
                    file.id === activeId
                      ? 'h-3.5 w-[3px] shrink-0 bg-brand'
                      : 'h-3.5 w-[3px] shrink-0 bg-transparent'
                  }
                />
                {/* The name takes the slack so every folder starts at the
                    same column, whatever the names are called. */}
                <span className="min-w-0 flex-1 truncate text-xs">{file.name}</span>
                <span className="max-w-[55%] shrink-0 truncate font-mono text-[10px] text-muted-foreground/70">
                  {folderOf(file.path)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator className="mx-0 my-1" />

          <CommandGroup className="p-0">
            <CommandItem
              value="__add__"
              onSelect={onAddFile}
              className="gap-2.5 rounded-none px-3 py-1.5 text-xs"
            >
              <Plus className="size-3.5 text-brand-bright" />
              {t('panel.trackAnotherFile')}
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </PanelBody>
  );
}

/** The containing folder, which is what tells two same-named scores apart. */
function folderOf(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator > 0 ? path.slice(0, separator) : path;
}
