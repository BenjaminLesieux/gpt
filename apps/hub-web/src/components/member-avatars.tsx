import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { dateLocale, until } from '@gpt/ui/lib/time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@gpt/ui/tooltip';
import type { Member } from '@/lib/api';
import { initials } from '@gpt/ui/score/history';

/**
 * Who a score is shared with, as one square each.
 *
 * It takes people rather than addresses, which is the only reason it is a
 * component and not four lines in the header: when an account grows a
 * `display_name`, the change is `initials(member.email)` and one tooltip, and
 * every caller keeps passing exactly what it passes now.
 *
 * The dashed square is the other half. Somebody invited has no membership row
 * until they open the link, so a list drawn from memberships alone shows the
 * inviter nothing at all — and nothing reads as *the link never sent*, which
 * is the one wrong thing it could say.
 */
export function MemberAvatars({ members }: { members: Member[] }) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);

  return (
    <ul className="flex gap-1">
      {members.map((member) => {
        const described = describe(member, locale, t);

        return (
          <li key={member.id}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    // A span is not in the tab order, and for the dashed
                    // square the tooltip is the only thing that says what it
                    // is — there are no letters in it to read.
                    tabIndex={0}
                    className={`flex size-6 items-center justify-center rounded-sm border font-mono text-[10px] text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                      member.status === 'joined'
                        ? 'border-border bg-accent'
                        : 'border-dashed border-border'
                    }`}
                  />
                }
              >
                {member.status === 'joined' ? initials(member.email) : null}
                {/* Without this the row is silent to a screen reader and
                    legible only to somebody holding a mouse still. */}
                <span className="sr-only">{described}</span>
              </TooltipTrigger>
              <TooltipContent
                className={member.status === 'joined' ? 'rounded-sm font-mono text-xs' : 'rounded-sm text-xs'}
              >
                {described}
              </TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

/** What the square means, in one line — the tooltip and the spoken name. */
function describe(member: Member, locale: string, t: TFunction): string {
  if (member.status === 'joined') {
    return member.role === 'owner' ? t('members.owner', { email: member.email }) : member.email;
  }

  // Named by who held the link out, because nobody else can be: an invite is
  // a link, so there is no address on it until somebody accepts.
  return t('members.pending', {
    invitedBy: member.invitedBy,
    when: until(new Date(member.expiresAt), locale),
  });
}
