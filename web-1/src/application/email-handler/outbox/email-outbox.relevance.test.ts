import { describe, expect, it } from 'vitest';
import { isOutboxMessageRelevant } from './email-outbox.relevance';

const row = (templateId: string, ruleId = templateId) => ({
  templateId,
  ruleId,
});

describe('isOutboxMessageRelevant: a delayed mail never contradicts the account', () => {
  it('payment-failed and dunning only while the payment is not settled', () => {
    for (const message of [
      row('payment-failed'),
      row('dunning-urgent', 'DUNNING_D7_URGENT'),
    ]) {
      expect(
        isOutboxMessageRelevant(message, {
          payment_status: 'IN_PROGRESS',
          pricing_plan: 'PRO',
        })
      ).toBe(true);
      expect(
        isOutboxMessageRelevant(message, {
          payment_status: 'PAID',
          pricing_plan: 'PRO',
        })
      ).toBe(false);
    }
  });
  it('upgrade confirmation only while a paid plan is active; downgrade notice only while on Free', () => {
    const paid = { payment_status: 'PAID', pricing_plan: 'PRO' };
    const free = { payment_status: 'PAID', pricing_plan: 'FREE' };
    expect(isOutboxMessageRelevant(row('upgrade-confirmation'), paid)).toBe(
      true
    );
    expect(isOutboxMessageRelevant(row('upgrade-confirmation'), free)).toBe(
      false
    );
    expect(isOutboxMessageRelevant(row('downgrade-notification'), free)).toBe(
      true
    );
    expect(isOutboxMessageRelevant(row('downgrade-notification'), paid)).toBe(
      false
    );
  });
  it('a missing account suppresses every kind', () => {
    expect(isOutboxMessageRelevant(row('payment-failed'), null)).toBe(false);
  });
});
