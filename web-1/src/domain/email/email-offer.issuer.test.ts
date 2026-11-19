import { describe, expect, it } from 'vitest';
import { isMonthlyOnly, promotionCodeFromName } from './email-offer.issuer';

const item = (interval: string | null) => ({
  price: { recurring: interval === null ? null : { interval } },
});

describe('isMonthlyOnly', () => {
  it('accepts a monthly subscription', () => {
    expect(isMonthlyOnly([item('month')])).toBe(true);
  });

  it('refuses a yearly subscription (a once coupon would cut a whole year)', () => {
    expect(isMonthlyOnly([item('year')])).toBe(false);
  });

  it('refuses an empty or non-recurring item list', () => {
    expect(isMonthlyOnly([])).toBe(false);
    expect(isMonthlyOnly([item(null)])).toBe(false);
  });
});

describe('promotionCodeFromName', () => {
  it('uses the ASCII first name and a four-character suffix', () => {
    expect(promotionCodeFromName('Łucja Kowalska')).toMatch(
      /^LUCJA-[A-Z2-9]{4}$/
    );
    expect(promotionCodeFromName('Jürgen Weiß')).toMatch(
      /^JURGEN-[A-Z2-9]{4}$/
    );
    expect(promotionCodeFromName('Anna')).toMatch(/^ANNA-[A-Z2-9]{4}$/);
  });

  it('falls back to NF for a name without letters', () => {
    expect(promotionCodeFromName('  ')).toMatch(/^NF-[A-Z2-9]{4}$/);
  });
});
