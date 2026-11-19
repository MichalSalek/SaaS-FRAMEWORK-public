// A profile save names only the fields the editor changed. Address keys that
// are absent stay as stored, so a phone save cannot wipe a city.

import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { normalizeCountryCode } from '@kernel/domain/localization/country.config';

export type AddressSection = {
  address_street?: string | null;
  address_city?: string | null;
  address_postal_code?: string | null;
  address_country?: string | null;
};

export type StoredAddress = {
  address_street: string | null;
  address_city: string | null;
  address_postal_code: string | null;
  address_country: string | null;
};

export type GeocodeQuery = {
  street: string | null;
  city: string;
  postal_code: string | null;
  country: string;
};

export type GeocodedAddress = {
  query: GeocodeQuery;
  latitude: number;
  longitude: number;
};

/** Revalidate under the owner's row lock; a result for an older address must never replace its pin. */
export function reconcileAddressWrite(
  section: AddressSection,
  current: StoredAddress | null,
  geocoded: GeocodedAddress | null
):
  | { ok: false }
  | {
      ok: true;
      patch: Partial<StoredAddress> & {
        latitude?: number | null;
        longitude?: number | null;
      };
    } {
  const plan = planAddressWrite(section, current);
  if (!plan.ok) {
    return plan;
  }
  const sameAddress =
    plan.geocode !== null &&
    geocoded !== null &&
    plan.geocode.street === geocoded.query.street &&
    plan.geocode.city === geocoded.query.city &&
    plan.geocode.postal_code === geocoded.query.postal_code &&
    plan.geocode.country === geocoded.query.country;
  return {
    ok: true,
    patch: {
      ...plan.patch,
      ...(plan.clearCoordinates ? { latitude: null, longitude: null } : {}),
      ...(sameAddress && geocoded !== null
        ? { latitude: geocoded.latitude, longitude: geocoded.longitude }
        : {}),
    },
  };
}

export type AddressWritePlan =
  | { ok: false }
  | {
      ok: true;
      patch: Partial<StoredAddress>;
      geocode: GeocodeQuery | null;
      clearCoordinates: boolean;
    };

const ADDRESS_KEYS = [
  'address_street',
  'address_city',
  'address_postal_code',
  'address_country',
] as const;

const hasOwn = (source: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(source, key);

const blankToNull = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const titled = (value: string | null | undefined): string | null => {
  const normalized =
    VALIDATION_POLICY.utils.normalizeStringCapitalizedWords(value);
  return normalized === '' ? null : normalized;
};

// DECISION: geocoding runs only when the merged address changed and a city
// remains. Clearing the city drops stored coordinates in the caller; a failed
// geocode leaves them. A street with no city is refused before any write, so
// an old pin cannot survive a half-filled address.
export function planAddressWrite(
  section: AddressSection,
  current: StoredAddress | null
): AddressWritePlan {
  const touched = ADDRESS_KEYS.some(key => hasOwn(section, key));
  if (!touched) {
    return { ok: true, patch: {}, geocode: null, clearCoordinates: false };
  }
  const stored: StoredAddress = current ?? {
    address_street: null,
    address_city: null,
    address_postal_code: null,
    address_country: null,
  };
  const nextStreet = hasOwn(section, 'address_street')
    ? blankToNull(section.address_street)
    : stored.address_street;
  const nextCity = hasOwn(section, 'address_city')
    ? titled(section.address_city)
    : stored.address_city;
  const nextPostal = hasOwn(section, 'address_postal_code')
    ? blankToNull(section.address_postal_code) === null
      ? null
      : VALIDATION_POLICY.utils.normalizeStringEliminateWhitespaces(
          section.address_postal_code
        )
    : stored.address_postal_code;
  const nextCountry = hasOwn(section, 'address_country')
    ? normalizeCountryCode(blankToNull(section.address_country))
    : normalizeCountryCode(stored.address_country);

  if (nextStreet && !nextCity) {
    return { ok: false };
  }

  const patch: Partial<StoredAddress> = {};
  if (hasOwn(section, 'address_street')) {
    patch.address_street = nextStreet;
  }
  if (hasOwn(section, 'address_city')) {
    patch.address_city = nextCity;
  }
  if (hasOwn(section, 'address_postal_code')) {
    patch.address_postal_code = nextPostal;
  }
  if (hasOwn(section, 'address_country')) {
    patch.address_country = nextCountry;
  }

  const changed =
    nextStreet !== stored.address_street ||
    nextCity !== stored.address_city ||
    nextPostal !== stored.address_postal_code ||
    nextCountry !== normalizeCountryCode(stored.address_country);

  if (!nextCity || !nextCountry) {
    return { ok: true, patch, geocode: null, clearCoordinates: true };
  }
  if (!changed) {
    return { ok: true, patch, geocode: null, clearCoordinates: false };
  }
  return {
    ok: true,
    patch,
    clearCoordinates:
      nextCountry !== normalizeCountryCode(stored.address_country),
    geocode: {
      street: nextStreet,
      city: nextCity,
      postal_code: nextPostal,
      country: nextCountry,
    },
  };
}

const readSentString = (
  source: object,
  key: string
): string | null | undefined => {
  if (!hasOwn(source, key)) {
    return undefined;
  }
  const value = Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
  return typeof value === 'string' ? value : null;
};

export function addressSectionFrom(
  source: object | null | undefined
): AddressSection {
  if (source == null) {
    return {};
  }
  const section: AddressSection = {};
  const street = readSentString(source, 'address_street');
  const city = readSentString(source, 'address_city');
  const postal = readSentString(source, 'address_postal_code');
  const country = readSentString(source, 'address_country');
  if (street !== undefined) {
    section.address_street = street;
  }
  if (city !== undefined) {
    section.address_city = city;
  }
  if (postal !== undefined) {
    section.address_postal_code = postal;
  }
  if (country !== undefined) {
    section.address_country = country;
  }
  return section;
}
