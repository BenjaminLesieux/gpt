import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@gpt/ui/alert-dialog';
import { Button } from '@gpt/ui/button';
import { dateLocale, since } from '@gpt/ui/lib/time';
import { Spinner } from '@gpt/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gpt/ui/table';
import { HubError, type CompanionToken } from '@/lib/api';
import { companionTokensQuery, useRevokeCompanionToken } from '@/lib/queries';

const HEAD = 'h-8 bg-card text-xs font-medium uppercase tracking-wide';

/**
 * The computers signed in to this account, as opposed to the ones a score is
 * on. Absent until there is one: a companion that never signed in has nothing
 * to revoke.
 */
export function CompanionDevices() {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const devices = useQuery(companionTokensQuery);
  const revoke = useRevokeCompanionToken();
  const [revoking, setRevoking] = useState<CompanionToken | null>(null);

  if (!devices.data?.length) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-md font-medium tracking-tight">{t('devices.title')}</h2>
      <div className="border border-border">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD}>{t('devices.columns.device')}</TableHead>
              <TableHead className={`${HEAD} w-[190px]`}>{t('devices.columns.lastSeen')}</TableHead>
              <TableHead className={`${HEAD} w-[140px]`}>
                <span className="sr-only">{t('scores.columns.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.data.map((device) => (
              <TableRow key={device.id}>
                <TableCell className="h-10 truncate py-0 text-base">{device.device}</TableCell>
                <TableCell className="h-10 truncate py-0 text-sm text-muted-foreground">
                  {device.lastUsedAt
                    ? since(new Date(device.lastUsedAt), locale)
                    : t('devices.neverSeen')}
                </TableCell>
                <TableCell className="h-10 py-0 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6.5 rounded-sm px-2.5 text-sm"
                    onClick={() => {
                      revoke.reset();
                      setRevoking(device);
                    }}
                  >
                    {t('devices.revoke')}
                    <span className="sr-only">{` ${device.device}`}</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('devices.confirm.title', { device: revoking?.device })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('devices.confirm.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          {revoke.error != null && (
            <p role="alert" className="text-sm text-destructive">
              {revoke.error instanceof HubError ? revoke.error.message : t('common.genericError')}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revoke.isPending}
              onClick={() =>
                revoking &&
                revoke.mutate(revoking.id, { onSuccess: () => setRevoking(null) })
              }
            >
              {revoke.isPending && <Spinner data-icon="inline-start" />}
              {t('devices.confirm.revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
