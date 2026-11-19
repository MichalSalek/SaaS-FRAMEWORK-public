import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../test-utils/renderWithProviders';
import pl from '../../../../locales/pl/common.json';
import type { PlanChangePreview } from '../hooks/usePlanChangePreview';
import { PlanChangeQuoteMolecule } from './PlanChangeQuote.molecule';

vi.mock('../../../hooks/useCurrentLang', () => ({
  useCurrentLang: () => 'pl',
}));

describe('plan-change quote recovery', () => {
  it('leads a scheduled cancellation to plan management instead of an ineffective refresh', () => {
    const refetch = vi.fn();
    renderWithProviders(
      <PlanChangeQuoteMolecule
        preview={
          {
            canceling: true,
            isError: true,
            isFetching: false,
            refetch,
          } as unknown as PlanChangePreview
        }
      />,
      { locale: 'pl', messages: pl }
    );
    expect(
      screen.getByRole('link', { name: 'Przejdź do zarządzania planem' })
    ).toHaveAttribute('href', '/app/user/account/plan');
    expect(
      screen.queryByRole('button', { name: 'Odśwież wycenę' })
    ).not.toBeInTheDocument();
    expect(refetch).not.toHaveBeenCalled();
  });
  it('refreshes an expired quote without sending a plan mutation', () => {
    const refetch = vi.fn();
    renderWithProviders(
      <PlanChangeQuoteMolecule
        preview={
          {
            canceling: false,
            expired: true,
            isFetching: false,
            refetch,
          } as unknown as PlanChangePreview
        }
      />,
      { locale: 'pl', messages: pl }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Odśwież wycenę' }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
