import { act, renderHook, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePairingOutcome } from './usePairingOutcome';
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: { name: string }) =>
    `${key}:${values?.name ?? ''}`,
}));
const account = {
  account_id: 'stylist-a',
  display_name: 'Marta',
  business_name: null,
};
describe('pairing outcome', () => {
  it('distinguishes new, already pending and connected responses', () => {
    const { result } = renderHook(() => usePairingOutcome('stylist-a'));
    act(() =>
      result.current.confirm(account, { status: 'PENDING', created: false })
    );
    const view = render(result.current.feedback('clientPending'));
    expect(screen.getByRole('status')).toHaveTextContent(
      'pairAlreadyPending:Marta'
    );
    expect(view.container.querySelector('svg')).toBeNull();
    act(() =>
      result.current.confirm(account, { status: 'PENDING', created: true })
    );
    view.rerender(result.current.feedback('clientPending'));
    expect(screen.getByRole('status')).toHaveTextContent(
      'pairRequestPending:Marta'
    );
    expect(view.container.querySelector('svg')).not.toBeNull();
    act(() => result.current.confirm(account, { status: 'ALREADY_PAIRED' }));
    expect(result.current.feedback('clientPending')).toBeNull();
    view.rerender(result.current.feedback('clientPaired'));
    expect(screen.getByRole('status')).toHaveTextContent(
      'pairAlreadyConnected:Marta'
    );
    expect(view.container.querySelector('svg')).toBeNull();
  });
  it('does not show another profile’s previous result', () => {
    const { result, rerender } = renderHook(({ id }) => usePairingOutcome(id), {
      initialProps: { id: 'stylist-a' },
    });
    act(() =>
      result.current.confirm(account, { status: 'PENDING', created: true })
    );
    expect(result.current.feedback('clientPending')).not.toBeNull();
    expect(result.current.feedback('clientPublic')).toBeNull();
    expect(result.current.feedback('clientPaired')).toBeNull();
    rerender({ id: 'stylist-b' });
    expect(result.current.feedback('clientPending')).toBeNull();
  });
});
