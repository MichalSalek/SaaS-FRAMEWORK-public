/**
 * Unit tests — mailbox normalization for the magic-link throttle: every spelling that reaches the
 * same inbox shares ONE budget, so rotating the spelling is not a bypass.
 */
import { describe, it, expect } from 'vitest';
import { domainToASCII } from 'node:url';
import {
  normalizeEmailForThrottle,
  throttleKeyPart,
} from './email-throttle-key';

describe('normalizeEmailForThrottle', () => {
  const base = 'victim@example.com';

  it.each([
    'victim@example.com',
    'VICTIM@EXAMPLE.COM',
    '  victim@example.com  ',
    'victim+promo@example.com',
    'victim+a+b@example.com',
    'victim@example.com.',
    'vic​tim@example.com',
    'ｖictim@example.com', // full-width v
    'victim@ＥＸＡＭＰＬＥ.com',
  ])('%j collapses to the same mailbox', variant => {
    expect(normalizeEmailForThrottle(variant)).toBe(base);
  });

  it('Gmail: dots and the googlemail alias collapse', () => {
    expect(normalizeEmailForThrottle('v.i.c.t.i.m+x@googlemail.com')).toBe(
      'victim@gmail.com'
    );
    expect(normalizeEmailForThrottle('Victim@Gmail.com')).toBe(
      'victim@gmail.com'
    );
  });

  it('dots stay significant outside Gmail', () => {
    expect(normalizeEmailForThrottle('a.b@example.com')).not.toBe(
      normalizeEmailForThrottle('ab@example.com')
    );
  });

  it('Unicode domains collapse with their punycode form', () => {
    const ascii = `ola@${domainToASCII('zażółć.pl')}`;
    expect(ascii).toMatch(/@xn--/);
    expect(normalizeEmailForThrottle('ola@zażółć.pl')).toBe(ascii);
    expect(normalizeEmailForThrottle(ascii)).toBe(ascii);
  });

  it.each(['', 'no-at-sign', '@example.com', 'victim@'])(
    '%j is not a mailbox',
    raw => {
      expect(normalizeEmailForThrottle(raw)).toBeNull();
    }
  );

  it('key parts are opaque: no address in the key', () => {
    const key = throttleKeyPart(base);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain('victim');
    expect(throttleKeyPart(base)).toBe(key);
  });
});
