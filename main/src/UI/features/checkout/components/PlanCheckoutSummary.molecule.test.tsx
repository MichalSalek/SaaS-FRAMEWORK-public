// Render check of the last step before payment, with the real locale files.
//
// DECISION: a deliberate exception to "frontend Vitest = hooks and logic, not UI components", same
// reason as PricingTierSection.render-sanity: the owner's report ("Netto 179,00 zł / VAT 23% 0,00
// zł / Brutto 0,00 zł") was a correct template fed with figures of two different charges, which no
// type or audit can see; only the rendered text shows it. Assertions are text only, no class names.
// (owner)

import { describe, expect, it, vi } from 'vitest';
import type { AbstractIntlMessages } from 'next-intl';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import plMessages from '../../../../locales/pl/common.json';
import enMessages from '../../../../locales/en/common.json';
import deMessages from '../../../../locales/de/common.json';
import { renderWithProviders } from '../../../../test-utils/renderWithProviders';
import {
  buildCheckoutSummaryModel,
  type CheckoutSummarySource,
} from '../checkout-summary.helpers';
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
  SESSION_TRIAL_PRO_MONTHLY,
  SESSION_TRIAL_PRO_YEARLY,
  SESSION_TRIAL_STUDIO_MONTHLY,
} from '../checkout-summary.fixtures';
import { PlanCheckoutSummaryMolecule } from './PlanCheckoutSummary.molecule';

// The plans query only adds the icon; the name falls back to kernel data.
vi.mock('../../shared/pricing/hooks/usePricingPlans', () => ({
  usePricingPlans: () => ({ data: undefined }),
}));

const lang = vi.hoisted(() => ({ value: 'pl' }));
vi.mock('../../../hooks/useCurrentLang', () => ({
  useCurrentLang: () => lang.value,
}));

type Messages = typeof plMessages;

function renderSummary(
  session: CheckoutSummarySource,
  planId: PricingPlan,
  billingPeriod: BillingPeriod,
  messages: Messages = plMessages,
  locale = 'pl',
  currency?: string
): string[] {
  lang.value = locale;
  const c = messages.account.checkout;
  const { container } = renderWithProviders(
    <PlanCheckoutSummaryMolecule
      planId={planId}
      model={buildCheckoutSummaryModel(session, billingPeriod)}
      {...(currency && { currency })}
      tx={{
        cycleMonthly: c.cycleMonthly,
        cycleYearly: c.cycleYearly,
        totalLabel: c.totalLabel,
        netLabel: c.netLabel,
        vatLabel: c.vatLabel,
        grossLabel: c.grossLabel,
        trialTitle: c.trialTitle,
        trialSub: c.trialSub,
      }}
    />,
    { messages: messages as unknown as AbstractIntlMessages, locale }
  );
  // One entry per text element, in reading order, spaces normalised.
  return Array.from(container.querySelectorAll('div, p, h3, li, span'), node =>
    Array.from(node.childNodes).every(child => child.nodeType === 3)
      ? (node.textContent ?? '').replaceAll(' ', ' ').trim()
      : ''
  ).filter(text => text !== '');
}

describe('PlanCheckoutSummaryMolecule', () => {
  it('shows USD from the Stripe session beside amounts formatted with a bare dollar sign', () => {
    const amount = (minorUnitsAmount: number, formatted: string) => ({
      minorUnitsAmount,
      amount: formatted,
    });
    const zero = amount(0, '$0.00');
    const price = amount(1900, '$19.00');
    const session: CheckoutSummarySource = {
      total: {
        subtotal: price,
        discount: zero,
        taxExclusive: zero,
        taxInclusive: zero,
        total: zero,
      },
      recurring: {
        interval: 'month',
        trial: { trialEnd: 1794312000, trialPeriodDays: 30 },
        dueNext: {
          subtotal: price,
          discount: zero,
          taxExclusive: zero,
          taxInclusive: zero,
          total: price,
        },
      },
      discountAmounts: null,
    };
    const lines = renderSummary(
      session,
      PricingPlanValue.PRO,
      'month',
      enMessages,
      'en',
      'usd'
    );
    expect(lines).toContain('Free trial (USD)');
    expect(lines).toContain('$19.00');
    expect(lines).toContain('$0.00');
  });
  it('trial start, Studio monthly: two blocks, each consistent', () => {
    expect(
      renderSummary(
        SESSION_TRIAL_STUDIO_MONTHLY,
        PricingPlanValue.STUDIO,
        'month'
      )
    ).toEqual([
      'Studio',
      'Bezpłatny okres próbny',
      'Dziś płacisz',
      '0,00 zł',
      '30 dni za darmo, do 10 listopada 2026',
      'Od razu korzystasz ze wszystkich możliwości planu Studio',
      'W cenie do 10 kont dla zespołu, bez dopłat za stanowisko',
      'Wspólna galeria całego zespołu',
      'Profil publiczny salonu pod własnym adresem',
      'Możliwości planu Studio na własnym koncie każdej stylistki',
      'Po okresie próbnym',
      'Pierwszą płatność pobierzemy 10 listopada 2026, a kolejne co miesiąc.',
      'Netto',
      '179,00 zł',
      'VAT 23%',
      '41,17 zł',
      'Brutto',
      '220,17 zł',
      'Jeśli zrezygnujesz na stronie Plan przed końcem okresu próbnego, nic nie zapłacisz.',
      'Dziś nie obciążymy karty',
      'Podajesz kartę teraz, aby po okresie próbnym korzystać z planu bez przerwy.',
    ]);
  });

  it('trial start, Pro monthly', () => {
    expect(
      renderSummary(SESSION_TRIAL_PRO_MONTHLY, PricingPlanValue.PRO, 'month')
    ).toEqual([
      'Pro',
      'Bezpłatny okres próbny',
      'Dziś płacisz',
      '0,00 zł',
      '30 dni za darmo, do 10 listopada 2026',
      'Od razu korzystasz ze wszystkich możliwości planu Pro',
      'Nieograniczona galeria',
      'Nieograniczone klientki',
      'Karta klientki: notatki (alergie, preferencje) i wizyty z ostatnich 90 dni',
      'Zdjęcia bez znaku wodnego',
      'Po okresie próbnym',
      'Pierwszą płatność pobierzemy 10 listopada 2026, a kolejne co miesiąc.',
      'Netto',
      '60,00 zł',
      'VAT 23%',
      '13,80 zł',
      'Brutto',
      '73,80 zł',
      'Jeśli zrezygnujesz na stronie Plan przed końcem okresu próbnego, nic nie zapłacisz.',
      'Dziś nie obciążymy karty',
      'Podajesz kartę teraz, aby po okresie próbnym korzystać z planu bez przerwy.',
    ]);
  });

  it('trial start, Pro yearly: the recurring block is the yearly charge', () => {
    const lines = renderSummary(
      SESSION_TRIAL_PRO_YEARLY,
      PricingPlanValue.PRO,
      'year'
    );
    expect(lines.slice(10, 18)).toEqual([
      'Po okresie próbnym',
      'Pierwszą płatność pobierzemy 10 listopada 2026, a kolejne raz w roku.',
      'Netto',
      '600,00 zł',
      'VAT 23%',
      '138,00 zł',
      'Brutto',
      '738,00 zł',
    ]);
  });

  it('start without a trial: the full first payment and no trial wording', () => {
    const lines = renderSummary(
      SESSION_NO_TRIAL_PRO_MONTHLY,
      PricingPlanValue.PRO,
      'month'
    );
    expect(lines).toEqual([
      'Pro',
      'Rozliczenie co miesiąc',
      'Netto',
      '60,00 zł',
      'VAT 23%',
      '13,80 zł',
      'Dziś płacisz (brutto)',
      '73,80 zł',
      'Kolejne płatności: 73,80 zł brutto co miesiąc.',
    ]);
    expect(lines.join(' ')).not.toMatch(/próbn|za darmo|nie obciążymy/);
  });

  it('promotion code: its own line, what it covers, and the price after it', () => {
    expect(
      renderSummary(SESSION_PROMO_PRO_MONTHLY, PricingPlanValue.PRO, 'month')
    ).toEqual([
      'Pro',
      'Rozliczenie co miesiąc',
      'Netto',
      '60,00 zł',
      'Rabat Pierwszy miesiąc 20% (tylko pierwsza płatność)',
      '−12,00 zł',
      'VAT 23%',
      '11,04 zł',
      'Dziś płacisz (brutto)',
      '59,04 zł',
      'Kolejne płatności: 73,80 zł brutto co miesiąc.',
    ]);
  });

  it('amount unavailable: says so and prints no 0,00 for the first payment', () => {
    const lines = renderSummary(
      SESSION_TRIAL_AMOUNT_UNAVAILABLE,
      PricingPlanValue.STUDIO,
      'month'
    );
    expect(lines.slice(10)).toEqual([
      'Po okresie próbnym',
      'Nie udało się pobrać kwoty płatności zaplanowanej na 10 listopada 2026. Spróbuj ponownie przed rozpoczęciem okresu próbnego.',
      'Jeśli zrezygnujesz na stronie Plan przed końcem okresu próbnego, nic nie zapłacisz.',
      'Dziś nie obciążymy karty',
      'Podajesz kartę teraz, aby po okresie próbnym korzystać z planu bez przerwy.',
    ]);
    expect(lines).not.toContain('Brutto');
  });

  it('German (Sie): the same structure', () => {
    const lines = renderSummary(
      SESSION_TRIAL_STUDIO_MONTHLY,
      PricingPlanValue.STUDIO,
      'month',
      deMessages as unknown as Messages,
      'de'
    );
    expect(lines.slice(0, 5)).toEqual([
      'Studio',
      'Kostenlose Testphase',
      'Heute zahlen Sie',
      '0,00 zł',
      '30 Tage kostenlos, bis zum 10. November 2026',
    ]);
    expect(lines).toContain('MwSt. 23%');
    expect(lines).toContain('Ihre Karte wird heute nicht belastet');
  });

  it('renders the inclusive monthly total and VAT wording in Polish', () => {
    const lines = renderSummary(
      SESSION_GROSS_STUDIO_MONTHLY,
      PricingPlanValue.STUDIO,
      'month'
    );

    expect(lines).toContain('W tym VAT 23%');
    expect(lines).toContain('33,47 zł');
    expect(lines).toContain('Dziś płacisz (brutto)');
    expect(lines).toContain('179,00 zł');
    expect(lines).toContain('Kolejne płatności: 179,00 zł brutto co miesiąc.');
    expect(lines.join(' ')).not.toContain('Netto');
  });

  it('renders the same inclusive monthly summary in English and German Sie', () => {
    const englishLines = renderSummary(
      SESSION_GROSS_STUDIO_MONTHLY,
      PricingPlanValue.STUDIO,
      'month',
      enMessages as unknown as Messages,
      'en'
    );
    expect(englishLines).toContain('VAT included (23%)');
    expect(englishLines).toContain('You pay today (gross)');
    expect(englishLines).toContain(
      'Following payments: 179,00 zł gross every month.'
    );
    expect(englishLines.join(' ')).not.toContain('Net');

    const germanLines = renderSummary(
      SESSION_GROSS_STUDIO_MONTHLY,
      PricingPlanValue.STUDIO,
      'month',
      deMessages as unknown as Messages,
      'de'
    );
    expect(germanLines).toContain('Enthaltene MwSt. (23%)');
    expect(germanLines).toContain('Heute zahlen Sie (brutto)');
    expect(germanLines).toContain(
      'Weitere Zahlungen: 179,00 zł brutto jeden Monat.'
    );
    expect(germanLines.join(' ')).not.toContain('Netto');
  });

  it('shows the annual gross and included tax from the session', () => {
    const lines = renderSummary(
      SESSION_GROSS_STUDIO_YEARLY,
      PricingPlanValue.STUDIO,
      'month'
    );
    expect(lines).toContain('Rozliczenie raz w roku');
    expect(lines).toContain('W tym VAT 23%');
    expect(lines).toContain('320,88 zł');
    expect(lines).toContain('1716,00 zł');

    const trialLines = renderSummary(
      SESSION_GROSS_TRIAL_STUDIO_MONTHLY,
      PricingPlanValue.STUDIO,
      'month'
    );
    expect(trialLines).toContain('Dziś płacisz');
    expect(trialLines).toContain('0,00 zł');
    expect(trialLines).toContain('W tym VAT 23%');
    expect(trialLines).toContain('33,47 zł');
    expect(trialLines).toContain('179,00 zł');
    expect(trialLines.join(' ')).not.toContain('Netto');
  });

  it('shows the gross discount and reduced VAT for a one-time coupon', () => {
    const lines = renderSummary(
      SESSION_GROSS_PROMO_STUDIO_MONTHLY,
      PricingPlanValue.STUDIO,
      'month'
    );
    expect(lines).toContain('Cena przed rabatem (brutto)');
    expect(lines).toContain('179,00 zł');
    expect(lines).toContain(
      'Rabat Pierwszy miesiąc 20% (tylko pierwsza płatność)'
    );
    expect(lines).toContain('−35,80 zł');
    expect(lines).toContain('W tym VAT 23%');
    expect(lines).toContain('26,78 zł');
    expect(lines).toContain('Dziś płacisz (brutto)');
    expect(lines).toContain('143,20 zł');
    expect(lines).toContain('Kolejne płatności: 179,00 zł brutto co miesiąc.');
  });

  it('shows a full coupon zero and hides conflicting tax detail', () => {
    const discounted = renderSummary(
      SESSION_GROSS_FULL_DISCOUNT_STUDIO_MONTHLY,
      PricingPlanValue.STUDIO,
      'month'
    );
    expect(discounted).toContain('Cena przed rabatem (brutto)');
    expect(discounted).toContain('Rabat QA 100% (każda płatność)');
    expect(discounted).toContain('W tym VAT');
    expect(discounted).toContain('179,00 zł');
    expect(discounted).toContain('−179,00 zł');
    expect(discounted).toContain('0,00 zł');

    const inconsistent = renderSummary(
      SESSION_GROSS_INCONSISTENT_TAX,
      PricingPlanValue.STUDIO,
      'month'
    );
    expect(inconsistent).toContain('Dziś płacisz (brutto)');
    expect(inconsistent).toContain('179,00 zł');
    expect(inconsistent.join(' ')).not.toContain('W tym VAT');
  });
});
