// The deadline sentence rendered through the REAL messages of all three
// locales: the ICU plural/select nesting is the part a stub cannot prove.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTranslator } from 'next-intl';
import pl from '../../../locales/pl/common.json';
import en from '../../../locales/en/common.json';
import de from '../../../locales/de/common.json';
import {
  formatExpiryDeadline,
  formatExpiryRemaining,
} from './sessionTime.formatters';
import type { TSessions } from './sessionTime.formatters';

const MESSAGES = { pl, en, de } as const;

// Intl may put a narrow no-break space before „PM”, and the one-letter words
// are glued to the next one with a hard space.
const plain = (s: string) => s.replace(/[\u202f\u00a0]/g, ' ');

const deadline = (...args: Parameters<typeof formatExpiryDeadline>) =>
  plain(formatExpiryDeadline(...args));

const tFor = (locale: keyof typeof MESSAGES): TSessions =>
  createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace: 'pages.sessions',
  }) as unknown as TSessions;

// Monday 19 October 2026, 10:00 local time; the deadline is local too.
const NOW = new Date(2026, 9, 19, 10, 0);
const SATURDAY = new Date(2026, 9, 24, 14, 30).toISOString();

describe('formatExpiryDeadline', () => {
  it('names the weekday, the date and the hour for the client', () => {
    expect(deadline(SATURDAY, tFor('pl'), 'Szkic', 'client', 'pl', NOW)).toBe(
      'Stylistka widzi tę sesję do soboty 24 października o godz. 14:30. Po tym terminie sesja pozostanie tylko u Ciebie.'
    );
    expect(deadline(SATURDAY, tFor('en'), '', 'client', 'en', NOW)).toBe(
      'Your stylist can see this session until Saturday, October 24, 2:30 PM. After that, it stays only with you.'
    );
    expect(deadline(SATURDAY, tFor('de'), '', 'client', 'de', NOW)).toBe(
      'Ihre Stylistin sieht diese Sitzung bis Samstag, 24. Oktober, 14:30 Uhr. Danach bleibt die Sitzung nur bei Ihnen.'
    );
  });

  it('speaks to the stylist about herself', () => {
    expect(deadline(SATURDAY, tFor('pl'), '', 'stylist', 'pl', NOW)).toBe(
      'Widzisz tę sesję do soboty 24 października o godz. 14:30. Po tym terminie zniknie z Twojej listy.'
    );
  });

  it('keeps a one-letter word with the next one', () => {
    expect(
      formatExpiryDeadline(SATURDAY, tFor('pl'), '', 'client', 'pl', NOW)
    ).toContain('tylko u\u00a0Ciebie.');
  });

  it('says today and tomorrow instead of a weekday', () => {
    const today = new Date(2026, 9, 19, 18, 0).toISOString();
    const tomorrow = new Date(2026, 9, 20, 9, 5).toISOString();
    expect(deadline(today, tFor('pl'), '', 'client', 'pl', NOW)).toContain(
      'do dziś o godz. 18:00.'
    );
    expect(deadline(tomorrow, tFor('pl'), '', 'client', 'pl', NOW)).toContain(
      'do jutra o godz. 9:05.'
    );
    expect(deadline(tomorrow, tFor('de'), '', 'client', 'de', NOW)).toContain(
      'bis morgen, 9:05 Uhr.'
    );
  });

  it('returns the empty label before sharing and the expired status after', () => {
    expect(deadline(null, tFor('pl'), 'Szkic', 'client', 'pl', NOW)).toBe(
      'Szkic'
    );
    expect(
      deadline(
        new Date(2026, 9, 19, 9, 0).toISOString(),
        tFor('pl'),
        'Szkic',
        'client',
        'pl',
        NOW
      )
    ).toBe('Wygasła');
    expect(deadline('not-a-date', tFor('pl'), '', 'client', 'pl', NOW)).toBe(
      'Wygasła'
    );
  });
});

describe('formatExpiryRemaining', () => {
  const NOW_MS = NOW.getTime();
  const expiresAt = new Date(
    NOW_MS + 13 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000 + 22 * 60 * 1000
  ).toISOString();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses one days/hours/minutes value in every language', () => {
    expect(
      plain(formatExpiryRemaining(expiresAt, tFor('pl'), 'Szkic', 'pl'))
    ).toBe('Pozostało 13 dni 4 godz. 22 min');
    expect(
      plain(formatExpiryRemaining(expiresAt, tFor('en'), 'Draft', 'en'))
    ).toBe('Time left: 13 days 4 hr 22 min');
    expect(
      plain(formatExpiryRemaining(expiresAt, tFor('de'), 'Entwurf', 'de'))
    ).toBe('Noch 13 Tage 4 Std. 22 Min.');
  });

  it('falls back to the draft label before sharing', () => {
    expect(plain(formatExpiryRemaining(null, tFor('pl'), 'Szkic', 'pl'))).toBe(
      'Szkic'
    );
  });
});
