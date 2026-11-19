import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanChangePreviewResponse } from '@kernel/domain/user-and-account/account-checkout.types';
import { renderWithProviders } from '../../../../test-utils/renderWithProviders';
import pl from '../../../../locales/pl/common.json';
import en from '../../../../locales/en/common.json';
import de from '../../../../locales/de/common.json';
import type { PlanChangePreview } from '../hooks/usePlanChangePreview';
import { PlanChangeQuoteMolecule } from './PlanChangeQuote.molecule';

const current = vi.hoisted(() => ({ locale: 'pl' }));
vi.mock('../../../hooks/useCurrentLang', () => ({
  useCurrentLang: () => current.locale,
}));

const baseQuote: PlanChangePreviewResponse = {
  quoteId: '92e0a485-f5fb-451c-848a-851165b7c998',
  expiresAt: '2030-01-01T12:30:00Z',
  amountDue: 2900,
  total: 2900,
  taxAmount: null,
  currency: 'usd',
  billingPeriod: 'month',
  trialEndsAt: null,
  cancelAt: null,
};

function renderQuote(
  changes: Partial<PlanChangePreviewResponse>,
  locale: 'pl' | 'en' | 'de' = 'pl'
) {
  current.locale = locale;
  const preview = {
    data: { ...baseQuote, ...changes },
    isFetching: false,
    isError: false,
    expired: false,
    canceling: false,
  } as unknown as PlanChangePreview;
  return renderWithProviders(<PlanChangeQuoteMolecule preview={preview} />, {
    locale,
    messages: { pl, en, de }[locale],
  });
}

afterEach(() => vi.useRealTimers());

describe('plan-change quote terms', () => {
  it('omits a historical trial from a paid quote and keeps the immediate and regular prices distinct', () => {
    renderQuote({
      trialEndsAt: '2020-01-01T00:00:00Z',
      regularAmount: 9900,
      nextBillingAt: '2030-02-01T12:00:00Z',
    });

    expect(screen.queryByText(/Okres próbny trwa do/)).not.toBeInTheDocument();
    expect(screen.getByText('29 USD')).toBeInTheDocument();
    expect(
      screen.getByText('Cena regularna: 99 USD brutto miesięcznie.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Kolejne rozliczenie: 1 lutego 2030.')
    ).toBeInTheDocument();
  });

  it('shows a future trial but not one ending exactly now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T12:00:00Z'));
    const { rerender } = renderQuote({ trialEndsAt: '2030-01-02T12:00:00Z' });
    expect(
      screen.getByText(/Okres próbny trwa do 2 stycznia 2030/)
    ).toBeInTheDocument();

    rerender(
      <PlanChangeQuoteMolecule
        preview={
          {
            data: { ...baseQuote, trialEndsAt: '2030-01-01T12:00:00Z' },
            isFetching: false,
            isError: false,
            expired: false,
          } as unknown as PlanChangePreview
        }
      />
    );
    expect(screen.queryByText(/Okres próbny trwa do/)).not.toBeInTheDocument();
  });

  it('shows the entire annual price, not a monthly equivalent', () => {
    renderQuote({ billingPeriod: 'year', regularAmount: 118800 });
    expect(
      screen.getByText('Cena regularna: 1188 USD brutto za cały rok.')
    ).toBeInTheDocument();
  });

  it('does not invent optional terms for an older response', () => {
    renderQuote({});
    expect(screen.getByText('29 USD')).toBeInTheDocument();
    expect(screen.queryByText(/Cena regularna:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Kolejne rozliczenie:/)).not.toBeInTheDocument();
  });

  it.each([
    ['en', /Standard price:.*USD.*99.*per month/, /Next billing date:/],
    ['de', /Regulärer Preis:.*99.*USD.*pro Monat/, /Nächste Abrechnung:/],
  ] as const)('renders the translated terms in %s', (locale, price, next) => {
    renderQuote(
      { regularAmount: 9900, nextBillingAt: '2030-02-01T12:00:00Z' },
      locale
    );
    expect(screen.getByText(price)).toBeInTheDocument();
    expect(screen.getByText(next)).toBeInTheDocument();
  });
});
