import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { AbstractIntlMessages } from 'next-intl';
import plMessages from '../../../../locales/pl/common.json';
import enMessages from '../../../../locales/en/common.json';
import deMessages from '../../../../locales/de/common.json';
import { renderWithProviders } from '../../../../test-utils/renderWithProviders';
import { EntryPriceNoteMolecule } from './EntryPriceNote.molecule';

const state = vi.hoisted(() => ({ currency: 'pln' as 'pln' | 'eur' | 'usd' }));
vi.mock('./hooks/usePricingPlans', () => ({
  usePricingPlans: () => ({
    data: [
      {
        id: 'PRO',
        priceMonthly: 6050,
        priceYearly: 4800,
        priceYearlyTotal: 57599,
      },
    ],
    isPending: false,
    isError: false,
    pricesUnavailable: false,
    currency: state.currency,
  }),
}));
const messages = {
  pl: plMessages,
  en: enMessages,
  de: deMessages,
} as unknown as Record<string, AbstractIntlMessages>;

describe('entry price note', () => {
  it.each([
    ['pl', 'pln', '60,50 PLN', '575,99 PLN'],
    ['de', 'eur', '60,50 EUR', '575,99 EUR'],
    ['en', 'usd', 'USD 60.50', 'USD 575.99'],
  ] as const)(
    'shows monthly and annual amounts in %s',
    (locale, currency, monthly, total) => {
      state.currency = currency;
      renderWithProviders(<EntryPriceNoteMolecule withYearly />, {
        locale,
        messages: messages[locale],
      });
      const note = screen.getByText(/Free Demo/, { selector: 'span' });
      const text = note.textContent?.replace(/\s+/g, ' ');
      expect(text).toContain(monthly);
      expect(text).toContain(total);
    }
  );
});
