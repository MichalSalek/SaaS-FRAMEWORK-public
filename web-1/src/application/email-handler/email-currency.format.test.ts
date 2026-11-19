import { describe, expect, it } from 'vitest';
import { formatEmailCurrency } from './email-currency.format';

describe('renewal email currency', () => {
  it('formats the actual amount in the requested locale and currency', () => {
    expect(formatEmailCurrency(12765, 'pln', 'pl')).toBe('127,65 PLN');
    expect(formatEmailCurrency(0, 'pln', 'en')).toBe('PLN 0.00');
    expect(formatEmailCurrency(1499, 'eur', 'de')).toBe('14,99 EUR');
  });
  it('handles zero-decimal currencies and Stripe ISK/UGX minor units', () => {
    expect(formatEmailCurrency(1200, 'jpy', 'en')).toBe('JPY 1,200');
    expect(formatEmailCurrency(1200, 'isk', 'en')).toBe('ISK 12');
    expect(formatEmailCurrency(1200, 'ugx', 'en')).toBe('UGX 12');
  });
  it('preserves all cents for a large safe integer', () => {
    expect(formatEmailCurrency(Number.MAX_SAFE_INTEGER, 'pln', 'en')).toBe(
      'PLN 90,071,992,547,409.91'
    );
  });
  it.each([
    [-1, 'pln'],
    [1.5, 'pln'],
    [NaN, 'pln'],
    [100, 'bad'],
    [100, 'invalid'],
  ])('rejects invalid values %s %s', (amount, currency) => {
    expect(formatEmailCurrency(amount, currency, 'pl')).toBeNull();
  });
});
