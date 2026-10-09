// UI/features/messaging/hooks/useMessageWhen.ts
// One wording of „when” for the inbox row and the message bubble.
//
// Why: the inbox printed a bare „02:24” for today (census S126: „a time with
// no date, cannot tell when”) and the thread printed day, month, YEAR and time
// under every bubble. Now: today says so, this year drops the year, an older
// message carries it. Days are compared in the app's time zone (the one the
// formatter prints in), never in the browser's, so the label and the printed
// date cannot disagree around midnight.

import { useCallback } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

const TIME = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;

export function useMessageWhen() {
  const t = useTranslations('pages.messaging');
  const format = useFormatter();

  return useCallback(
    (
      value: string | Date | null,
      { withTime = false }: { withTime?: boolean } = {}
    ): string => {
      if (value == null) {
        return '';
      }
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) {
        return '';
      }
      const now = new Date();
      const dayOf = (d: Date) =>
        format.dateTime(d, {
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
        });
      if (dayOf(date) === dayOf(now)) {
        return t('whenToday', { time: format.dateTime(date, TIME) });
      }
      const sameYear =
        format.dateTime(date, { year: 'numeric' }) ===
        format.dateTime(now, { year: 'numeric' });
      return format.dateTime(date, {
        day: 'numeric',
        month: 'short',
        ...(sameYear ? {} : { year: 'numeric' }),
        ...(withTime ? TIME : {}),
      });
    },
    [format, t]
  );
}
