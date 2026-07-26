import { useTranslation } from 'react-i18next';
import { FileMusic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { PanelBody } from './PanelShell';

/** Nothing tracked yet — the only thing the panel can usefully offer. */
export function TrackFirstFile({ onAddFile }: { onAddFile(): void }) {
  const { t } = useTranslation();

  return (
    <PanelBody data-panel-stagger="">
      <Empty className="flex-1 justify-center gap-3 p-6">
        <EmptyHeader className="gap-1.5">
          <EmptyMedia variant="icon" className="mb-1 size-9 rounded-none bg-brand-dim text-brand-bright">
            <FileMusic className="size-5" />
          </EmptyMedia>
          <EmptyTitle className="text-md font-bold tracking-tight">
            {t('panel.empty.title')}
          </EmptyTitle>
          <EmptyDescription className="text-xs">{t('panel.empty.description')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={onAddFile}>
            {t('panel.empty.action')}
          </Button>
        </EmptyContent>
      </Empty>
    </PanelBody>
  );
}
