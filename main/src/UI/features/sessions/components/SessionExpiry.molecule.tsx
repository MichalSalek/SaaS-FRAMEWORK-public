// UI/features/sessions/components/SessionExpiry.molecule.tsx
// One expiry atom for both roles and both densities: the shared-session
// confirmation, the stylist's list row and both session detail headers.
//
// DECISION: the screen says how much time is LEFT, not only the deadline. The
// old long sentence ("Stylistka widzi tę sesję do …") was a paragraph in the
// hero; the row merged "Otwarta jeszcze 13 dni" into a calque. This atom keeps
// one wording and one clock: days/hours/minutes, no seconds, refreshed every
// 30 s. The list row uses the same value, so the two views cannot disagree.
// The deadline stays as the second, quieter line in the detail. (owner)

import { useEffect, useState } from 'react';
import { ClockIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import { formatRemainingValue } from '../sessionTime.formatters';
import styles from './SessionExpiry.module.css';

export function formatExpiryDeadline(
  expiresAt: string,
  locale: string
): string {
  const deadline = new Date(expiresAt);
  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
  }).format(deadline);
  const time = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(deadline);
  return `${date}, ${time}`;
}

export function SessionExpiryMolecule({
  expiresAt,
  variant = 'detail',
  emptyLabel,
}: {
  expiresAt: string | null;
  variant?: 'detail' | 'row';
  /** A session not shared yet has no clock; the caller supplies its own line. */
  emptyLabel?: string;
}) {
  const t = useTranslations('pages.sessions');
  const locale = useCurrentLang();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (expiresAt === null) {
    return emptyLabel ? (
      <span className={styles.empty}>{emptyLabel}</span>
    ) : null;
  }

  const deadline = new Date(expiresAt);
  if (
    !Number.isFinite(deadline.getTime()) ||
    deadline.getTime() <= Date.now()
  ) {
    return <span className={styles.expired}>{t('expiryExpired')}</span>;
  }

  // Use the render-time clock on the first frame (server and client agree to
  // the minute in practice) and switch to the 30 s ticker after mount: the
  // line never flashes a meaningless „chwilę” while the countdown waits.
  const value = formatRemainingValue(expiresAt, locale, now ?? Date.now());
  const remaining =
    value === null
      ? t('expirySoonValue')
      : t('expiryRemainingValue', { value });

  if (variant === 'row') {
    return <span className={styles.row}>{remaining}</span>;
  }

  return (
    <span className={styles.detail}>
      <span className={styles.remaining}>
        <ClockIcon size={14} weight='regular' aria-hidden='true' />
        {remaining}
      </span>
      <span className={styles.deadline}>
        {t('expiryDeadline', {
          date: formatExpiryDeadline(expiresAt, locale),
        })}
      </span>
    </span>
  );
}
