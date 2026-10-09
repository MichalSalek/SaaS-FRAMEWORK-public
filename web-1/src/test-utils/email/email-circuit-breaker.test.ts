/**
 * Unit tests — email circuit breaker: format parametru `begin` w Mailgun Events API.
 *
 * REGRESJA (2026-08-31): poll leciał z `windowStart.toISOString()`, a Mailgun
 * przyjmuje w `begin` wyłącznie czas rfc-2822 albo sekundy od epoki. Każde
 * odpytanie kończyło się `HTTP 400 Bad Request` → `fetchMailgunBounceStats`
 * zwracał `api-failure`, breaker szedł fail-open i strażnik bounce-rate był
 * ślepy (nigdy nie zadziałał na produkcji). Test pilnuje, żeby `begin` został
 * liczbą, i żeby okno było tym deklarowanym (24 h wstecz).
 *
 * Cache breakera żyje w module (`_cache` + TTL 1 h), a testy dzielą jeden
 * import — dlatego każdy przypadek przesuwa zegar PONAD TTL, inaczej kolejne
 * wywołania nie odpytują Mailguna i asercje po pustej liście przechodzą na
 * pusto (fałszywa zieleń). Stąd też twarde `toHaveLength(3)` przy każdym pollu.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  envVars: {
    MAILGUN_API_KEY: 'key-test',
    MAILGUN_API_BASE_URL: 'https://api.eu.mailgun.net',
    MAILGUN_DOMAIN: 'mg.example.com',
  },
}));

vi.mock('@app/environment/environment.config', () => ({ ENV_VARS: h.envVars }));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
vi.mock('@app/event-log/event-log-io.wrapper', () => ({
  recordAuditEvent_IO: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@app/event-log/system-actor', () => ({
  resolveSystemActorId_IO: vi.fn().mockResolvedValue('system'),
}));

import { refreshBounceRateCache } from '@app/email-handler/email-circuit-breaker';

const WINDOW_HOURS = 24;
const MS_PER_HOUR = 60 * 60 * 1000;
/** > CACHE_TTL_MS (1 h), żeby każdy przypadek realnie odpytał Mailguna. */
const CLOCK_STEP_MS = 3 * MS_PER_HOUR;

/** Poll odpytuje trzy klasy zdarzeń: hard-bounce, delivered, failed. */
const EXPECTED_QUERY_COUNT = 3;

let clock = new Date('2026-08-31T12:00:00.000Z').getTime();

/** Wyciąga wartości `begin` ze wszystkich URL-i, którymi poll uderzył w Mailguna. */
const collectBeginParams = (fetchMock: ReturnType<typeof vi.fn>): string[] =>
  fetchMock.mock.calls.map(
    call => new URL(String(call[0])).searchParams.get('begin') ?? ''
  );

describe('email circuit breaker — parametr `begin` w Mailgun Events API', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    clock += CLOCK_STEP_MS;
    vi.setSystemTime(clock);
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ items: [], paging: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('wysyła `begin` jako sekundy od epoki, nie jako ISO-8601', async () => {
    await refreshBounceRateCache();

    const begins = collectBeginParams(fetchMock);
    expect(begins).toHaveLength(EXPECTED_QUERY_COUNT);

    for (const begin of begins) {
      // Mailgun: „Has to be either rfc-2822 time or seconds from epoch".
      expect(begin).toMatch(/^\d+$/);
      expect(begin).not.toContain('T');
      expect(begin).not.toContain('Z');
    }
  });

  it('okno `begin` to dokładnie 24 h wstecz', async () => {
    await refreshBounceRateCache();

    const begins = collectBeginParams(fetchMock);
    expect(begins).toHaveLength(EXPECTED_QUERY_COUNT);

    const expectedEpochSeconds = Math.floor(
      (clock - WINDOW_HOURS * MS_PER_HOUR) / 1000
    );
    for (const begin of begins) {
      expect(Number(begin)).toBe(expectedEpochSeconds);
    }
  });

  it('odpytuje trzy klasy zdarzeń (hard-bounce, delivered, failed)', async () => {
    await refreshBounceRateCache();

    const queries = fetchMock.mock.calls.map(call => {
      const url = new URL(String(call[0]));
      return `${url.searchParams.get('event')}:${url.searchParams.get('severity') ?? '-'}`;
    });

    expect(queries).toHaveLength(EXPECTED_QUERY_COUNT);
    expect(queries).toContain('failed:permanent');
    expect(queries).toContain('delivered:-');
    expect(queries).toContain('failed:-');
  });
});
