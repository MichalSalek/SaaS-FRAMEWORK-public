import { describe, it, expect } from 'vitest';
import { TIME } from '@kernel/application/constants.config';
import {
  DEMO_NEW_CLIENTS,
  resolveDemoTime,
  type DemoMessageSpec,
} from './demo-content-seeding.clients-data';
import {
  DEMO_KAROLINA_ANIA_MESSAGES,
  DEMO_KAROLINA_OLA_MESSAGES,
} from './demo-content-seeding.karolina-data';

/**
 * Pinned time of day in demo conversations (see `DemoMessageSpec.clockUtc`).
 * The test exists because this class of bug shows up only on a screenshot: a
 * message from the future, or a thread in the wrong order, depends on the hour
 * the seed ran, so one run proves nothing.
 */
const THREADS: readonly (readonly DemoMessageSpec[])[] = [
  DEMO_KAROLINA_ANIA_MESSAGES,
  DEMO_KAROLINA_OLA_MESSAGES,
  ...DEMO_NEW_CLIENTS.map(client => client.messages),
];

/** Każda pełna godzina doby jako moment uruchomienia seeda. */
const SEED_MOMENTS = Array.from(
  { length: 24 },
  (_, hour) => new Date(Date.UTC(2026, 9, 10, hour, 7, 0))
);

describe('pora dnia w rozmowach demo', () => {
  it('przypina godzinę i zostawia dzień', () => {
    const now = new Date(Date.UTC(2026, 9, 10, 1, 55, 0));
    const at = resolveDemoTime(now, 48, [7, 12]);
    expect(at.toISOString()).toBe('2026-10-08T07:12:00.000Z');
  });

  it('nie przypina godziny w ostatniej dobie, bo wynik mógłby wypaść w przyszłości', () => {
    const now = new Date(Date.UTC(2026, 9, 10, 1, 55, 0));
    const at = resolveDemoTime(now, 2, [18, 0]);
    expect(at.getTime()).toBe(now.getTime() - 2 * TIME.MS_PER_HOUR);
  });

  it('wątek z przypiętą porą jest rosnący w czasie i cały w przeszłości o każdej godzinie seeda', () => {
    const pinned = THREADS.filter(thread =>
      thread.some(message => message.clockUtc !== undefined)
    );
    expect(pinned.length).toBeGreaterThan(0);
    for (const thread of pinned) {
      for (const now of SEED_MOMENTS) {
        const times = thread.map(message =>
          resolveDemoTime(now, message.hoursAgo, message.clockUtc).getTime()
        );
        expect(times.every(time => time < now.getTime())).toBe(true);
        expect([...times].sort((a, b) => a - b)).toEqual(times);
        expect(new Set(times).size).toBe(times.length);
      }
    }
  });

  it('przypięta pora to godziny pracy salonu w Polsce (07:00 do 19:00 UTC)', () => {
    for (const message of THREADS.flat()) {
      if (!message.clockUtc) {
        continue;
      }
      const [hour, minute] = message.clockUtc;
      expect(hour).toBeGreaterThanOrEqual(7);
      expect(hour).toBeLessThan(19);
      expect(minute).toBeGreaterThanOrEqual(0);
      expect(minute).toBeLessThan(60);
      expect(message.hoursAgo).toBeGreaterThanOrEqual(24);
    }
  });
});
