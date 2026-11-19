import { describe, expect, it } from 'vitest';
import { normalizePhoneForComparison } from './stylistProfile.helpers';

describe('normalizePhoneForComparison', () => {
  it('treats the formatted field value and the server value as the same phone', () => {
    expect(normalizePhoneForComparison('+48 511 222 334')).toBe(
      normalizePhoneForComparison('+48511222334')
    );
  });

  it('keeps empty and missing values equal', () => {
    expect(normalizePhoneForComparison(null)).toBe('');
    expect(normalizePhoneForComparison(undefined)).toBe('');
    expect(normalizePhoneForComparison('  ')).toBe('');
  });

  it('does not hide a real number change', () => {
    expect(normalizePhoneForComparison('+48 511 222 334')).not.toBe(
      normalizePhoneForComparison('+48 511 222 335')
    );
  });
});
