import { COUNTRY_CODES, type CountryCode } from './country-codes';
export { COUNTRY_CODES, type CountryCode } from './country-codes';

const countryCodes: ReadonlySet<string> = new Set(COUNTRY_CODES);

export const BILLING_CURRENCIES = ['pln', 'usd', 'eur'] as const;
export type BillingCurrency = (typeof BILLING_CURRENCIES)[number];
const euroCountries: ReadonlySet<string> = new Set([
  'AD',
  'AT',
  'AX',
  'BE',
  'BG',
  'BL',
  'CY',
  'DE',
  'EE',
  'ES',
  'FI',
  'FR',
  'GF',
  'GP',
  'GR',
  'HR',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MC',
  'ME',
  'MF',
  'MQ',
  'MT',
  'NL',
  'PM',
  'PT',
  'RE',
  'SI',
  'SK',
  'SM',
  'TF',
  'VA',
  'XK',
  'YT',
]);

export function isCountryCode(value: string): value is CountryCode {
  return countryCodes.has(value);
}

export function countryDisplayName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const fold = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
let legacyCountryNames: Map<string, CountryCode> | undefined;

/** Accept existing localized country names on reads; every new write uses a code. */
export function normalizeCountryCode(
  value: string | null | undefined
): CountryCode | null {
  if (!value) {
    return null;
  }
  const code = value.trim().toUpperCase();
  if (isCountryCode(code)) {
    return code;
  }
  legacyCountryNames ??= new Map(
    COUNTRY_CODES.flatMap(candidate =>
      ['en', 'pl', 'de'].map(
        locale =>
          [fold(countryDisplayName(candidate, locale)), candidate] as const
      )
    )
  );
  return legacyCountryNames.get(fold(value)) ?? null;
}

export function currencyForCountry(
  country: string | null | undefined
): BillingCurrency {
  const code = normalizeCountryCode(country);
  if (code === 'PL') {
    return 'pln';
  }
  return code !== null && euroCountries.has(code) ? 'eur' : 'usd';
}

export function isBillingCurrency(value: string): value is BillingCurrency {
  return (BILLING_CURRENCIES as readonly string[]).includes(value);
}
