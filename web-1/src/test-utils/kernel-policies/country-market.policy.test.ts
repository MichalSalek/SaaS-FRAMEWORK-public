import { describe, expect, it } from 'vitest';
import {
  currencyForCountry,
  normalizeCountryCode,
  COUNTRY_CODES,
} from '@kernel/domain/localization/country.config';
import {
  formatMoney,
  formatMinorAmount,
} from '@kernel/domain/pricing/money.format';

describe('country and subscription currency', () => {
  it.each([
    ['PL', 'pln'],
    ['US', 'usd'],
    ['DE', 'eur'],
    ['ES', 'eur'],
    ['CA', 'usd'],
    ['BG', 'eur'],
    [null, 'usd'],
  ])('maps %s without a language dependency', (country, currency) => {
    expect(currencyForCountry(country)).toBe(currency);
  });
  it('recognizes legacy names without inventing a country', () => {
    expect(normalizeCountryCode('Poland')).toBe('PL');
    expect(normalizeCountryCode('Deutschland')).toBe('DE');
    expect(normalizeCountryCode('Stany Zjednoczone')).toBe('US');
    expect(normalizeCountryCode('XX')).toBeNull();
    expect(normalizeCountryCode('T1')).toBeNull();
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
  });
  it('preserves cents and always identifies US dollars', () => {
    expect(formatMoney(1905, 'usd', 'en')).toMatch(/USD\s*19\.05/);
    expect(formatMoney(1905, 'usd', 'pl')).toMatch(/19,05\s*USD/);
    expect(formatMinorAmount(57599, 'en')).toBe('575.99');
    expect(formatMinorAmount(-100, 'pl')).toBe('-1');
  });
});
