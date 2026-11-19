import { describe, expect, it } from 'vitest';
import { resolveSoftAskSnoozed } from './push-soft-ask';

describe('resolveSoftAskSnoozed', () => {
  it('nothing stored: the card may show', () => {
    expect(resolveSoftAskSnoozed(null, 1000)).toBe(false);
  });
  it('a date in the future snoozes, a past one does not', () => {
    expect(resolveSoftAskSnoozed('2000', 1000)).toBe(true);
    expect(resolveSoftAskSnoozed('500', 1000)).toBe(false);
  });
  it('garbage in storage never hides the card forever', () => {
    expect(resolveSoftAskSnoozed('soon', 1000)).toBe(false);
  });
});
