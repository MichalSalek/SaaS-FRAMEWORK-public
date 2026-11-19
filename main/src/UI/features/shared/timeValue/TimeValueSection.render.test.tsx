import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { AbstractIntlMessages } from 'next-intl';
import plMessages from '../../../../locales/pl/common.json';
import { renderWithProviders } from '../../../../test-utils/renderWithProviders';
import { TimeValueSectionOrganism } from './TimeValueSection.organism';

const pricing = vi.hoisted(() => ({
  data: [
    {
      id: 'PRO',
      priceMonthly: 7900,
      priceYearly: null,
      priceYearlyTotal: null,
    },
  ],
  isPending: false,
  isError: false,
  pricesUnavailable: false,
  currency: 'pln',
}));
vi.mock('../pricing/hooks/usePricingPlans', () => ({
  usePricingPlans: () => pricing,
}));

describe('TimeValueSectionOrganism', () => {
  it.each([
    [0, '0 minut'],
    [1, '1 minuta'],
    [2, '2 minuty'],
    [5, '5 minut'],
    [80, '80 minut'],
  ])('uses the Polish duration for %s', (minutes, expected) => {
    renderWithProviders(<TimeValueSectionOrganism id='plural' />, {
      locale: 'pl',
      messages: plMessages as unknown as AbstractIntlMessages,
    });
    fireEvent.change(screen.getByLabelText('Ilość klientek dziennie'), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText('Czas wybierania stylizacji'), {
      target: { value: String(minutes) },
    });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
  it('updates the example and replaces invalid results', () => {
    renderWithProviders(<TimeValueSectionOrganism id='example' />, {
      locale: 'pl',
      messages: plMessages as unknown as AbstractIntlMessages,
    });
    expect(screen.getByText('80 minut')).toBeInTheDocument();
    expect(screen.getByText('1 godz. 20 min')).toBeInTheDocument();

    const field = screen.getByLabelText('Czas wybierania stylizacji');
    fireEvent.change(field, { target: { value: '' } });
    expect(
      screen.getByText('Uzupełnij obie wartości, aby zobaczyć wynik.')
    ).toBeInTheDocument();
    expect(screen.queryByText('80 minut')).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: '0' } });
    expect(screen.getByText('0 minut')).toBeInTheDocument();
  });

  it('does not display the price fallback when prices are unavailable', () => {
    pricing.pricesUnavailable = true;
    try {
      renderWithProviders(<TimeValueSectionOrganism id='example' />, {
        locale: 'pl',
        messages: plMessages as unknown as AbstractIntlMessages,
      });
      expect(screen.queryByText(/Free Demo/)).not.toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Porównaj z cennikiem' })
      ).toBeInTheDocument();
    } finally {
      pricing.pricesUnavailable = false;
    }
  });
});
