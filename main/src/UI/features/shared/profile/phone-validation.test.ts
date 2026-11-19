import { describe, expect, it } from 'vitest';
import { isValidPhoneNumber } from '@kernel/policies/validation.config';

describe('stored phone validation', () => {
  it('accepts international numbers with separators', () => {
    expect(isValidPhoneNumber('+48 511 222 333')).toBe(true);
    expect(isValidPhoneNumber('(22) 123-45-67')).toBe(true);
    expect(isValidPhoneNumber('+1 415 555 2671')).toBe(true);
  });

  it('rejects separators without a dialable number and overlong input', () => {
    expect(isValidPhoneNumber('---')).toBe(false);
    expect(isValidPhoneNumber('12345')).toBe(false);
    expect(isValidPhoneNumber('+1234567890123456')).toBe(false);
    expect(isValidPhoneNumber('javascript:alert(1)')).toBe(false);
  });
});
