import { afterEach, describe, expect, it, vi } from 'vitest';
import { geocodeAddress } from './geocoding.utils';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
vi.mock('./nominatim.client', () => ({
  enqueueNominatim: (run: () => Promise<unknown>) => run(),
  nominatimEndpoint: () => 'https://maps.example.test/search',
  nominatimUserAgent: () => 'Nailfolio-Test',
}));

afterEach(() => vi.unstubAllGlobals());

describe('address geocoding country boundary', () => {
  it('restricts the lookup to the selected country', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          lat: '52.52',
          lon: '13.40',
          display_name: 'Berlin',
          address: { country_code: 'de' },
        },
      ],
    });
    vi.stubGlobal('fetch', request);
    expect(
      await geocodeAddress({ city: 'Berlin', country: 'DE' })
    ).toMatchObject({ country_code: 'DE' });
    const url = new URL(request.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get('countrycodes')).toBe('de');
    expect(url.searchParams.get('addressdetails')).toBe('1');
  });

  it('rejects a result in another country even if coordinates are valid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '41.76',
            lon: '-72.64',
            display_name: 'East Hartford',
            address: { country_code: 'us' },
          },
        ],
      })
    );
    expect(
      await geocodeAddress({ city: 'East Hartford', country: 'PL' })
    ).toBeNull();
  });
});
