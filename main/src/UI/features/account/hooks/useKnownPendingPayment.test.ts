import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PendingSubscriptionPayment } from '@kernel/models/session/session.dto';
import { useKnownPendingPayment } from './useKnownPendingPayment';
const payment: PendingSubscriptionPayment = {
  reason: 'plan_change',
  invoiceId: 'in_owned',
  url: 'https://invoice.stripe.com/i/owned',
  currency: 'pln',
  amountRemaining: 1200,
  expiresAt: null,
};
type Input = {
  actor: string | undefined;
  value: PendingSubscriptionPayment | undefined;
  known: boolean;
  enabled: boolean;
};
describe('known pending invoice and an unavailable Stripe read', () => {
  it('retains an owned invoice on failure and clears it only on a known result', () => {
    const { result, rerender } = renderHook(
      ({ actor, value, known, enabled }: Input) =>
        useKnownPendingPayment(actor, value, known, enabled),
      {
        initialProps: {
          actor: 'owner',
          value: payment,
          known: true,
          enabled: true,
        } as Input,
      }
    );
    expect(result.current).toBe(payment);
    rerender({ actor: 'owner', value: undefined, known: false, enabled: true });
    expect(result.current).toBe(payment);
    rerender({ actor: 'owner', value: undefined, known: true, enabled: true });
    expect(result.current).toBeUndefined();
  });
  it('does not invent an invoice or reveal another account invoice after switching session', () => {
    const { result, rerender } = renderHook(
      ({ actor, value, known, enabled }: Input) =>
        useKnownPendingPayment(actor, value, known, enabled),
      {
        initialProps: {
          actor: undefined,
          value: undefined,
          known: false,
          enabled: true,
        } as Input,
      }
    );
    expect(result.current).toBeUndefined();
    rerender({ actor: 'owner', value: payment, known: true, enabled: true });
    expect(result.current).toBe(payment);
    rerender({ actor: 'other', value: undefined, known: false, enabled: true });
    expect(result.current).toBeUndefined();
    rerender({
      actor: 'owner',
      value: undefined,
      known: false,
      enabled: false,
    });
    expect(result.current).toBeUndefined();
  });
});
