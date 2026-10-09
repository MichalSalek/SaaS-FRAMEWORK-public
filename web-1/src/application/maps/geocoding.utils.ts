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
};

import { reportIssueBackend } from '@app/debugger/error-handler';

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

    // Nominatim requires a User-Agent header
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': 'Beauty-SaaS-App/1.0',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      reportIssueBackend({
        namespace: 'geocoding',
        mode: 'error',
        message: 'Geocoding API error',
        payload: { status: response.statusText, query },
      });
      return null;
    }

    const data = await response.json();

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

    return {
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      display_name: result.display_name,
    };
  } catch (error) {
    reportIssueBackend({
      namespace: 'geocoding',
      mode: 'error',
      message: 'Geocoding error',
      payload: error,
    });
    return null;
  }
};
