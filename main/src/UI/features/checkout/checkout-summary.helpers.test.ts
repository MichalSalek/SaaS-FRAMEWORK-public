import { describe, expect, it } from 'vitest';
import {
  buildCheckoutSummaryModel,
  type CheckoutSummarySource,
} from './checkout-summary.helpers';
import {
  SESSION_GROSS_FULL_DISCOUNT_STUDIO_MONTHLY,
  SESSION_GROSS_INCONSISTENT_TAX,
  SESSION_GROSS_PROMO_STUDIO_MONTHLY,
  SESSION_GROSS_STUDIO_MONTHLY,
  SESSION_GROSS_STUDIO_YEARLY,
  SESSION_GROSS_TRIAL_STUDIO_MONTHLY,
  SESSION_NO_TRIAL_PRO_MONTHLY,
  SESSION_PROMO_PRO_MONTHLY,
  SESSION_TRIAL_AMOUNT_UNAVAILABLE,
  SESSION_TRIAL_PRO_YEARLY,
  SESSION_TRIAL_STUDIO_MONTHLY,
  TRIAL_END_UNIX,
} from './checkout-summary.fixtures';

const amount = (minor: number, text: string) => ({
  minorUnitsAmount: minor,
  amount: text,
});

describe('buildCheckoutSummaryModel', () => {
  it('keeps a regular inclusive monthly amount gross and reports its VAT', () => {
    expect(
      buildCheckoutSummaryModel(SESSION_GROSS_STUDIO_MONTHLY, 'month')
    ).toEqual({
      kind: 'pay',
      interval: 'month',
      nextGross: '179,00 zł',
      today: {
        kind: 'inclusive',
        beforeDiscountGross: '179,00 zł',
        discount: null,
        vat: '33,47 zł',
        vatRatePercent: 23,
        gross: '179,00 zł',
      },
    });
  });

  it('uses the annual gross and included VAT from Stripe', () => {
    expect(
      buildCheckoutSummaryModel(SESSION_GROSS_STUDIO_YEARLY, 'month')
    ).toMatchObject({
      kind: 'pay',
      interval: 'year',
      today: {
        kind: 'inclusive',
        vat: '320,88 zł',
        vatRatePercent: 23,
        gross: '1716,00 zł',
      },
      nextGross: '1716,00 zł',
    });
  });

  it('keeps a zero trial charge separate from the first gross payment', () => {
    expect(
      buildCheckoutSummaryModel(SESSION_GROSS_TRIAL_STUDIO_MONTHLY, 'month')
    ).toMatchObject({
      kind: 'trial',
      todayGross: '0,00 zł',
      next: {
        kind: 'inclusive',
        beforeDiscountGross: '179,00 zł',
        discount: null,
        vat: '33,47 zł',
        vatRatePercent: 23,
        gross: '179,00 zł',
      },
    });
  });

  it('applies a one-time coupon to gross, including the reduced included VAT', () => {
    expect(
      buildCheckoutSummaryModel(SESSION_GROSS_PROMO_STUDIO_MONTHLY, 'month')
    ).toMatchObject({
      kind: 'pay',
      today: {
        kind: 'inclusive',
        beforeDiscountGross: '179,00 zł',
        discount: {
          amount: '−35,80 zł',
          name: 'Pierwszy miesiąc 20%',
          duration: { type: 'once' },
        },
        vat: '26,78 zł',
        vatRatePercent: 23,
        gross: '143,20 zł',
      },
      nextGross: '179,00 zł',
    });
  });

  it('keeps a full gross coupon as a real zero payment', () => {
    expect(
      buildCheckoutSummaryModel(
        SESSION_GROSS_FULL_DISCOUNT_STUDIO_MONTHLY,
        'month'
      )
    ).toMatchObject({
      kind: 'pay',
      today: {
        kind: 'inclusive',
        beforeDiscountGross: '179,00 zł',
        discount: {
          amount: '−179,00 zł',
          name: 'QA 100%',
          duration: { type: 'forever' },
        },
        vat: '0,00 zł',
        vatRatePercent: null,
        gross: '0,00 zł',
      },
    });
  });

  it('falls back to the Stripe gross alone when tax fields conflict', () => {
    expect(
      buildCheckoutSummaryModel(SESSION_GROSS_INCONSISTENT_TAX, 'month')
    ).toMatchObject({
      kind: 'pay',
      today: { kind: 'gross-only', gross: '179,00 zł' },
    });
  });

  it('a trial keeps today and the recurring charge apart (the 179 / 0 / 0 report)', () => {
    const model = buildCheckoutSummaryModel(
      SESSION_TRIAL_STUDIO_MONTHLY,
      'month'
    );

    expect(model).toEqual({
      kind: 'trial',
      todayGross: '0,00 zł',
      trialEndsAt: new Date(TRIAL_END_UNIX * 1000),
      trialDays: 30,
      interval: 'month',
      next: {
        kind: 'breakdown',
        net: '179,00 zł',
        discount: null,
        vat: '41,17 zł',
        vatRatePercent: 23,
        gross: '220,17 zł',
      },
    });
  });

  it('takes the interval from the session, not from the request', () => {
    const model = buildCheckoutSummaryModel(SESSION_TRIAL_PRO_YEARLY, 'month');
    expect(model.interval).toBe('year');
  });

  it('falls back to the requested cycle when the session names none', () => {
    const model = buildCheckoutSummaryModel(
      { ...SESSION_NO_TRIAL_PRO_MONTHLY, recurring: null },
      'year'
    );
    expect(model).toMatchObject({
      kind: 'pay',
      interval: 'year',
      nextGross: null,
    });
  });

  it('without a trial today is the full first payment', () => {
    const model = buildCheckoutSummaryModel(
      SESSION_NO_TRIAL_PRO_MONTHLY,
      'month'
    );
    expect(model).toEqual({
      kind: 'pay',
      interval: 'month',
      nextGross: '73,80 zł',
      today: {
        kind: 'breakdown',
        net: '60,00 zł',
        discount: null,
        vat: '13,80 zł',
        vatRatePercent: 23,
        gross: '73,80 zł',
      },
    });
  });

  it('a once coupon discounts today only; the next payment is the full one', () => {
    const model = buildCheckoutSummaryModel(SESSION_PROMO_PRO_MONTHLY, 'month');
    expect(model).toMatchObject({
      kind: 'pay',
      nextGross: '73,80 zł',
      today: {
        kind: 'breakdown',
        net: '60,00 zł',
        discount: {
          amount: '−12,00 zł',
          name: 'Pierwszy miesiąc 20%',
          duration: { type: 'once' },
        },
        vat: '11,04 zł',
        vatRatePercent: 23,
        gross: '59,04 zł',
      },
    });
  });

  it('reads repeating and forever coupon durations', () => {
    const withDuration = (
      recurring: NonNullable<
        CheckoutSummarySource['discountAmounts']
      >[number]['recurring']
    ) =>
      buildCheckoutSummaryModel(
        {
          ...SESSION_PROMO_PRO_MONTHLY,
          discountAmounts: [{ displayName: ' ', recurring }],
        },
        'month'
      );

    expect(
      withDuration({ type: 'repeating', durationInMonths: 3 })
    ).toMatchObject({
      today: {
        discount: { name: null, duration: { type: 'months', months: 3 } },
      },
    });
    expect(withDuration({ type: 'forever' })).toMatchObject({
      today: { discount: { duration: { type: 'forever' } } },
    });
  });

  it('a recurring charge of zero without a discount is unavailable, never 0,00', () => {
    const model = buildCheckoutSummaryModel(
      SESSION_TRIAL_AMOUNT_UNAVAILABLE,
      'month'
    );
    expect(model).toMatchObject({
      kind: 'trial',
      next: { kind: 'unavailable' },
    });
  });

  it('a coupon covering the whole plan makes a real zero recurring charge', () => {
    const model = buildCheckoutSummaryModel(
      {
        ...SESSION_TRIAL_STUDIO_MONTHLY,
        recurring: {
          interval: 'month',
          trial: { trialEnd: TRIAL_END_UNIX, trialPeriodDays: 30 },
          dueNext: {
            subtotal: amount(17900, '179,00 zł'),
            discount: amount(17900, '179,00 zł'),
            taxExclusive: amount(0, '0,00 zł'),
            taxInclusive: amount(0, '0,00 zł'),
            total: amount(0, '0,00 zł'),
          },
        },
        discountAmounts: [
          { displayName: 'QA 100%', recurring: { type: 'forever' } },
        ],
      },
      'month'
    );
    expect(model).toMatchObject({
      next: { kind: 'inclusive', gross: '0,00 zł', vatRatePercent: null },
    });
  });

  it('figures that do not add up show the total alone', () => {
    const model = buildCheckoutSummaryModel(
      {
        ...SESSION_NO_TRIAL_PRO_MONTHLY,
        total: {
          subtotal: amount(6000, '60,00 zł'),
          discount: amount(0, '0,00 zł'),
          taxExclusive: amount(1380, '13,80 zł'),
          taxInclusive: amount(0, '0,00 zł'),
          // e.g. a customer balance applied by Stripe
          total: amount(5000, '50,00 zł'),
        },
      },
      'month'
    );
    expect(model).toMatchObject({
      kind: 'pay',
      today: { kind: 'gross-only', gross: '50,00 zł' },
    });
  });

  it('a VAT that no whole percent reproduces gets no rate', () => {
    const model = buildCheckoutSummaryModel(
      {
        ...SESSION_NO_TRIAL_PRO_MONTHLY,
        total: {
          subtotal: amount(6000, '60,00 zł'),
          discount: amount(0, '0,00 zł'),
          taxExclusive: amount(1350, '13,50 zł'),
          taxInclusive: amount(0, '0,00 zł'),
          total: amount(7350, '73,50 zł'),
        },
      },
      'month'
    );
    expect(model).toMatchObject({
      today: { kind: 'breakdown', vatRatePercent: null },
    });
  });

  it('missing amounts make today unavailable', () => {
    const model = buildCheckoutSummaryModel(
      {
        ...SESSION_NO_TRIAL_PRO_MONTHLY,
        total: {
          subtotal: amount(6000, '60,00 zł'),
          discount: amount(0, '0,00 zł'),
          taxExclusive: amount(1380, '13,80 zł'),
          taxInclusive: amount(0, '0,00 zł'),
          total: amount(Number.NaN, ''),
        },
      },
      'month'
    );
    expect(model).toMatchObject({
      kind: 'pay',
      today: { kind: 'unavailable' },
    });
  });
});
