type GeocodingAddress = {
  street?: string | null;
  city: string;
  postal_code?: string | null;
  country?: string | null;
};

type GeocodingResult = {
  latitude: number;
  longitude: number;
  display_name: string;
  country_code?: string | null;
};

import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  enqueueNominatim,
  nominatimEndpoint,
  nominatimUserAgent,
} from './nominatim.client';
import { TIME } from '@kernel/application/constants.config';
import { createCache } from '@app/cache/cache.utils';
import { normalizeCountryCode } from '@kernel/domain/localization/country.config';

const globalScope = globalThis as typeof globalThis & {
  __nailfolioAddressCache?: ReturnType<typeof createCache<GeocodingResult>>;
};
const addressCache = (globalScope.__nailfolioAddressCache ??=
  createCache<GeocodingResult>(TIME.MS_PER_DAY, 256));

/**
 * Geocode an address using OpenStreetMap Nominatim API (free, no API key required)
 * Rate limit: 1 request per second
 */
export const geocodeAddress = async (
  address: GeocodingAddress
): Promise<GeocodingResult | null> => {
  try {
    // Build query string from address components
    const parts: string[] = [];

    if (address.street) {
      parts.push(address.street);
    }
    if (address.city) {
      parts.push(address.city);
    }
    if (address.postal_code) {
      parts.push(address.postal_code);
    }
    if (address.country) {
      parts.push(address.country);
    }

    const query = parts.join(', ');

    if (!query) {
      return null;
    }
    const cached = addressCache.get(query);
    if (cached) {
      return cached;
    }

    // Nominatim requires a User-Agent header
    const country = normalizeCountryCode(address.country);
    const url = `${nominatimEndpoint('search')}?format=json&addressdetails=1&q=${encodeURIComponent(query)}&limit=1${country === null ? '' : `&countrycodes=${country.toLowerCase()}`}`;

    const { response, data } = await enqueueNominatim(async () => {
      // The upstream deadline starts on dispatch and covers reading the body too.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': nominatimUserAgent() },
          signal: controller.signal,
        });
        const data: unknown = response.ok ? await response.json() : null;
        return { response, data };
      } finally {
        clearTimeout(timeoutId);
      }
    });

    if (!response.ok) {
      reportIssueBackend({
        namespace: 'geocoding',
        mode: 'error',
        message: 'Geocoding API error',
        payload: { status: response.statusText, query },
      });
      return null;
    }

    if (!Array.isArray(data) || data.length === 0) {
      reportIssueBackend({
        namespace: 'geocoding',
        mode: 'warn',
        message: 'No geocoding results found',
        payload: { query },
      });
      return null;
    }

    const result = data[0];
    const resultCountry = normalizeCountryCode(result.address?.country_code);
    if (country !== null && resultCountry !== country) {
      return null;
    }

    const geocoded = {
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      display_name: result.display_name,
      country_code: resultCountry,
    };
    if (
      !Number.isFinite(geocoded.latitude) ||
      !Number.isFinite(geocoded.longitude)
    ) {
      return null;
    }
    addressCache.set(query, geocoded);
    return geocoded;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'NominatimQueueUnavailableError'
    ) {
      return null;
    }
    reportIssueBackend({
      namespace: 'geocoding',
      mode: 'error',
      message: 'Geocoding error',
      payload: error,
    });
    return null;
  }
};
