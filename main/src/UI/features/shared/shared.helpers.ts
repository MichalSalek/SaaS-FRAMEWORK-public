// UI/features/shared/shared.helpers.ts
// Pure helpers used by SharedPage and its parts. No JSX, no hooks.

import type { useTranslations } from 'next-intl';
import { TIME } from '@kernel/application/constants.config';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';

export type TShared = ReturnType<typeof useTranslations<'pages.shared'>>;

export const EXPIRING_SOON_MS = TIME.MS_PER_DAY; // 24h

/** The date line that belongs to an open session's status: how long it stays
 *  open. `null` for a draft (not shared yet, so nothing runs out). */
export function formatExpiryStatus(
  expiresAt: string | null,
  t: TShared
): string | null {
  if (expiresAt === null) {
    return null;
  }
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) {
    return t('expiredNeuter');
  }
  // The same clock as the client's list (sessions/sessionTime.formatters):
  // whole days, then whole hours, then "very soon". The two roles look at the
  // same session, so they must not read two different clocks.
  //
  // The WORDING continues the status pill that stands before it in the row
  // („Aktywna” + „jeszcze 6 dni”), so these strings do not stand alone; the
  // client's strings do („Aktywna jeszcze 6 dni”), because her pill says
  // „Udostępniona”. Until 2026-10-09 both said „Wygasa za 6 dni”, and a
  // reader without context could not tell what expires or what is lost. It
  // does not promise an archive: on Free the stylist has none.
  const days = Math.floor(diff / TIME.MS_PER_DAY);
  if (days > 0) {
    return t('expiresInDays', { days });
  }
  const hours = Math.floor(diff / TIME.MS_PER_HOUR);
  return hours > 0 ? t('expiresInHours', { hours }) : t('expiresSoon');
}

export function isExpiringSoon(expiresAt: string | null): boolean {
  if (expiresAt === null) {
    return false;
  }
  const diff = new Date(expiresAt).getTime() - Date.now();
  return diff > 0 && diff < EXPIRING_SOON_MS;
}

export function isDraft(expiresAt: string | null): boolean {
  return expiresAt === null;
}

export function formatArchiveDate(
  session: SessionContainerDTO,
  locale: string
): string {
  const ts =
    session.lifecycleState === SessionContainerLifecycleStateValue.CLOSED
      ? (session.closedAt ?? session.sharedAt ?? session.createdAt)
      : session.expiresAt;
  if (!ts) {
    return '';
  }
  return new Date(ts).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function getArchiveGroupKey(session: SessionContainerDTO): string {
  const ts =
    session.lifecycleState === SessionContainerLifecycleStateValue.CLOSED
      ? (session.closedAt ?? session.sharedAt ?? session.createdAt)
      : (session.expiresAt ?? session.sharedAt ?? session.createdAt);
  const date = new Date(ts);
  // YYYY-MM as stable key
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function formatGroupLabel(key: string, locale: string): string {
  const [yearStr, monthStr] = key.split('-');
  const date = new Date(Number(yearStr), Number(monthStr) - 1, 1);
  const label = date.toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });
  // Capitalize first letter (pl-PL returns lowercase month names).
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function getDisplayName(
  session: SessionContainerDTO,
  fallback: string
): string {
  // Stylist inbox identity = WHO shared the session. Prefer the client's real
  // name (now hydrated by the backend into clientName); fall back to the session
  // title if the client has no name set; last resort is the generic fallback.
  // The old clientAccountId handle ("Klientka ABCDEF") was a stopgap for the
  // missing name and is retired now that clientName is on the DTO.
  const clientName = session.clientName?.trim();
  if (clientName) {
    return clientName;
  }
  const sessionName = session.name?.trim();
  if (sessionName) {
    return sessionName;
  }
  return fallback;
}
