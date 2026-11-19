import { describe, expect, it } from 'vitest';
import plMessages from '../../../locales/pl/common.json';
import { resolveCheckoutAct } from './checkout-act.helpers';
import { buildCheckoutSummaryModel } from './checkout-summary.helpers';
import {
  SESSION_NO_TRIAL_PRO_MONTHLY,
  SESSION_TRIAL_STUDIO_MONTHLY,
} from './checkout-summary.fixtures';

const checkout = plMessages.account.checkout;
const t = (key: string): string =>
  key === 'summary.todayUnavailable'
    ? checkout.summary.todayUnavailable
    : key === 'summary.renewalUnavailable'
      ? checkout.summary.renewalUnavailable
      : checkout.trial[
          key.replace('trial.', '') as keyof typeof checkout.trial
        ];
const tx = {
  payNow: checkout.payNow,
  processing: checkout.processing,
  confirmError: checkout.confirmError,
  stillProcessing: checkout.stillProcessing,
};

describe('resolveCheckoutAct', () => {
  it('blocks starting a trial whose renewal amount is unavailable', () => {
    const model = buildCheckoutSummaryModel(
      SESSION_TRIAL_STUDIO_MONTHLY,
      'month'
    );
    expect(model.kind).toBe('trial');
    if (model.kind !== 'trial') {
      throw new Error('Trial fixture required');
    }
    const act = resolveCheckoutAct(
      { ...model, next: { kind: 'unavailable' } },
      t,
      tx
    );
    expect(act.amountUnknown).toBe(true);
    expect(act.amountUnknownText).toBe(checkout.summary.renewalUnavailable);
  });

  it('blocks a paid subscription without its renewal amount', () => {
    const model = buildCheckoutSummaryModel(
      SESSION_NO_TRIAL_PRO_MONTHLY,
      'month'
    );
    expect(model.kind).toBe('pay');
    if (model.kind !== 'pay') {
      throw new Error('Paid fixture required');
    }
    expect(
      resolveCheckoutAct({ ...model, nextGross: null }, t, tx).amountUnknown
    ).toBe(true);
  });
  it('a trial session never says „pay”', () => {
    const act = resolveCheckoutAct(
      buildCheckoutSummaryModel(SESSION_TRIAL_STUDIO_MONTHLY, 'month'),
      t,
      tx
    );
    expect(act.payNow).toBe('Rozpocznij okres próbny');
    expect(act.processing).toBe('Uruchamiamy okres próbny...');
    expect(act.confirmError).toBe(
      'Nie udało się potwierdzić karty. Sprawdź jej dane i spróbuj ponownie.'
    );
    expect(act.amountUnknown).toBe(false);
  });

  it('a session without a trial keeps the payment wording', () => {
    const act = resolveCheckoutAct(
      buildCheckoutSummaryModel(SESSION_NO_TRIAL_PRO_MONTHLY, 'month'),
      t,
      tx
    );
    expect(act.payNow).toBe('Zapłać za plan');
    expect(act.processing).toBe('Przetwarzamy płatność...');
    expect(act.amountUnknown).toBe(false);
  });

  it('no figure for today blocks the payment and says why', () => {
    const broken = {
      ...SESSION_NO_TRIAL_PRO_MONTHLY,
      total: {
        ...SESSION_NO_TRIAL_PRO_MONTHLY.total,
        total: { minorUnitsAmount: Number.NaN, amount: '' },
      },
    };
    const act = resolveCheckoutAct(
      buildCheckoutSummaryModel(broken, 'month'),
      t,
      tx
    );
    expect(act.amountUnknown).toBe(true);
    expect(act.amountUnknownText).toBe(
      'Nie udało się pobrać kwoty do zapłaty, więc nie pobieramy płatności. Spróbuj ponownie.'
    );
  });
});
