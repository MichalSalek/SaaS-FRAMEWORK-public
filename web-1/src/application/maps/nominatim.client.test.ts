import { afterEach, describe, expect, it, vi } from 'vitest';
import { geocodeAddress } from './geocoding.utils';
import {
  formatNominatimPlace,
  nominatimUserAgent,
  resetNominatimSchedulerForTests,
  reverseNominatimPlace,
  roundPairCoordinate,
} from './nominatim.client';

describe('formatNominatimPlace', () => {
  it('keeps a city, adds a district for a city, and leaves a village alone', () => {
    expect(formatNominatimPlace({ city: 'Kraków' })).toBe('Kraków');
    expect(formatNominatimPlace({ city: 'Kraków', suburb: 'Podgórze' })).toBe(
      'Kraków, Podgórze'
    );
    expect(
      formatNominatimPlace({ town: 'Wadowice', city_district: 'Śródmieście' })
    ).toBe('Wadowice, Śródmieście');
    expect(formatNominatimPlace({ village: 'Zelków', suburb: 'Centrum' })).toBe(
      'Zelków'
    );
    expect(formatNominatimPlace(undefined)).toBeNull();
    expect(formatNominatimPlace({})).toBeNull();
  });
});

describe('reverseNominatimPlace', () => {
  it('shares the one-second upstream budget with forward address lookup', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T00:00:00.000Z'));
    const starts: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        starts.push(Date.now());
        return {
          ok: true,
          status: 200,
          json: async () =>
            url.includes('/search?')
              ? [{ lat: '50', lon: '20', display_name: 'Kraków' }]
              : { address: { city: 'Kraków' } },
        };
      })
    );
    const reverse = reverseNominatimPlace(50.12, 19.94);
    const forward = geocodeAddress({ city: 'Kraków' });
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([reverse, forward]);
    expect(starts).toHaveLength(2);
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(1000);
  });
  afterEach(() => {
    resetNominatimSchedulerForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fails a queued lookup within the HTTP budget when upstream stalls', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T00:00:00.000Z'));
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    void reverseNominatimPlace(50.1, 19.1);
    await vi.advanceTimersByTimeAsync(0);
    let settled = false;
    let value: string | null | undefined;
    void reverseNominatimPlace(51.1, 19.1).then(result => {
      settled = true;
      value = result;
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(settled).toBe(true);
    expect(value).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caps pending work, coalesces duplicates, and does not cache unavailable lookups', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T00:00:00.000Z'));
    let release: ((response: unknown) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise(resolve => {
          release = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const active = reverseNominatimPlace(40, 10);
    await vi.advanceTimersByTimeAsync(0);
    const queued = Array.from({ length: 16 }, (_, i) =>
      reverseNominatimPlace(41 + i, 10)
    );
    const duplicate = reverseNominatimPlace(41, 10);
    expect(await reverseNominatimPlace(70, 10)).toBeNull();
    expect(await geocodeAddress({ city: 'Capacity test city' })).toBeNull();
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await Promise.all([...queued, duplicate])).toEqual(
      Array(17).fill(null)
    );
    release?.({ ok: true, json: async () => ({ address: { city: 'First' } }) });
    await active;
    const retried = reverseNominatimPlace(70, 10);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    release?.({
      ok: true,
      json: async () => ({ address: { city: 'Second' } }),
    });
    expect(await retried).toBe('Second');
  });

  it('identifies the app in the User-Agent and rounds before the request', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ address: { city: 'Kraków', suburb: 'Podgórze' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const place = await reverseNominatimPlace(50.06123, 19.94456);
    expect(place).toBe('Kraków, Podgórze');
    expect(roundPairCoordinate(50.06123)).toBe(50.06);
    const call = fetchMock.mock.calls[0] as unknown as
      [string, { headers: { 'User-Agent': string } }] | undefined;
    expect(call?.[0]).toContain('lat=50.06');
    expect(call?.[0]).toContain('lon=19.94');
    expect(call?.[0]).toContain('zoom=14');
    const agent = call?.[1].headers['User-Agent'] ?? '';
    expect(agent).toBe(nominatimUserAgent());
    expect(agent).toContain('Nailfolio');
    expect(agent).toContain('nailfolio.app');
  });

  it('serves a second lookup of the same cell from cache', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ address: { village: 'Zelków' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await reverseNominatimPlace(50.12, 19.94);
    await reverseNominatimPlace(50.124, 19.941);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('deduplicates an in-flight lookup and spaces a different cell by one second', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T00:00:00.000Z'));
    const resolvers: Array<(value: unknown) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise(resolve => {
          resolvers.push(resolve);
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const payload = {
      ok: true,
      status: 200,
      json: async () => ({ address: { city: 'Kraków' } }),
    };
    const first = reverseNominatimPlace(50.12, 19.94);
    const second = reverseNominatimPlace(50.12, 19.94);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const third = reverseNominatimPlace(51.11, 17.03);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstResponse = resolvers[0];
    if (firstResponse === undefined) {
      throw new Error('expected the first reverse lookup to start');
    }
    firstResponse(payload);
    await Promise.all([first, second]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondResponse = resolvers[1];
    if (secondResponse === undefined) {
      throw new Error('expected the second reverse lookup to start');
    }
    secondResponse(payload);
    await third;
  });
});
