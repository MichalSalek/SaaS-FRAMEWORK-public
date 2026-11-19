import { describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import type { StripeAddressElementChangeEvent } from '@stripe/stripe-js';

const mock = vi.hoisted(() => ({
  onChange: undefined as
    ((event: StripeAddressElementChangeEvent) => void) | undefined,
  update: vi.fn(),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@stripe/react-stripe-js/checkout', () => ({
  useCheckout: () => ({
    type: 'success',
    checkout: { updateBillingAddress: mock.update },
  }),
  BillingAddressElement: ({ onChange }: { onChange: typeof mock.onChange }) => {
    mock.onChange = onChange;
    return null;
  },
}));
import { CheckoutBillingAddressMolecule } from './CheckoutBillingAddress.molecule';
const event = (
  country: string,
  postal: string
): StripeAddressElementChangeEvent =>
  ({
    complete: true,
    value: {
      name: 'A',
      address: {
        country,
        postal_code: postal,
        city: 'New York',
        line1: '1 Main St',
        line2: null,
        state: 'NY',
      },
    },
  }) as StripeAddressElementChangeEvent;

describe('billing address before payment', () => {
  it('keeps preview blocked until a deferred buyer-address update has finished', async () => {
    mock.update.mockReset();
    let finish: ((value: unknown) => void) | undefined;
    mock.update.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const onReady = vi.fn();
    const nameRef = { current: null as string | null };
    render(
      <CheckoutBillingAddressMolecule
        country='US'
        onReady={onReady}
        billingNameRef={nameRef}
      />
    );
    act(() => mock.onChange?.(event('US', '10001')));
    expect(onReady).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(mock.update).toHaveBeenCalledOnce());
    expect(onReady).not.toHaveBeenCalledWith(true);
    await act(async () => {
      finish?.({ type: 'success' });
    });
    expect(onReady).toHaveBeenLastCalledWith(true);
    // Once preview starts, subsequent address events use the company name.
    nameRef.current = 'Salon Ltd';
    mock.update.mockResolvedValue({ type: 'success' });
    act(() => mock.onChange?.(event('US', '10002')));
    await waitFor(() =>
      expect(mock.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ name: 'Salon Ltd' })
      )
    );
  });
  it('keeps the saved company name when the address element emits the buyer name', async () => {
    mock.update.mockReset().mockResolvedValue({ type: 'success' });
    const nameRef = { current: 'Salon Ltd' };
    render(
      <CheckoutBillingAddressMolecule
        country='US'
        onReady={() => {}}
        billingNameRef={nameRef}
      />
    );
    act(() => mock.onChange?.(event('US', '10001')));
    await waitFor(() =>
      expect(mock.update).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Salon Ltd' })
      )
    );
  });
  it('prevents address edits while company preview or confirmation is in progress', () => {
    const view = render(
      <CheckoutBillingAddressMolecule onReady={() => {}} disabled />
    );
    expect(view.container.firstElementChild).toHaveAttribute('inert');
  });
  it('serializes address changes and does not mark an older quote ready', async () => {
    mock.update.mockReset();
    let finish!: (value: unknown) => void;
    mock.update.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    mock.update.mockResolvedValueOnce({ type: 'success' });
    const onReady = vi.fn();
    const onAddressChange = vi.fn();
    render(
      <CheckoutBillingAddressMolecule
        onReady={onReady}
        onAddressChange={onAddressChange}
      />
    );
    act(() => mock.onChange?.(event('PL', '00-001')));
    await waitFor(() => expect(mock.update).toHaveBeenCalledOnce());
    act(() => mock.onChange?.(event('DE', '10115')));
    expect(mock.update).toHaveBeenCalledOnce();
    await act(async () => finish({ type: 'success' }));
    await waitFor(() => expect(mock.update).toHaveBeenCalledTimes(2));
    expect(onReady).toHaveBeenCalledTimes(3);
    expect(onReady).toHaveBeenLastCalledWith(true);
    expect(onAddressChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: expect.objectContaining({ country: 'DE' }),
      })
    );
  });
  it('accepts the actual address country even when it differs from the detected hint', async () => {
    mock.update.mockReset();
    const onReady = vi.fn();
    let finish: ((value: unknown) => void) | undefined;
    mock.update.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const view = render(
      <CheckoutBillingAddressMolecule country='PL' onReady={onReady} />
    );
    act(() => mock.onChange?.(event('DE', '10115')));
    await waitFor(() => expect(mock.update).toHaveBeenCalledOnce());
    expect(view.queryByRole('alert')).toBeNull();
    expect(mock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        address: expect.objectContaining({ country: 'DE' }),
      })
    );
    expect(onReady).not.toHaveBeenCalledWith(true);
    await act(async () => {
      finish?.({ type: 'success' });
    });
    expect(onReady).toHaveBeenLastCalledWith(true);
  });
  it('defers a conflicting saved tax ID country to review before updating Stripe', async () => {
    mock.update.mockReset().mockResolvedValue({ type: 'success' });
    const onCountryInput = vi.fn(() => false);
    const onReady = vi.fn();
    render(
      <CheckoutBillingAddressMolecule
        onReady={onReady}
        onCountryInput={onCountryInput}
      />
    );
    act(() => mock.onChange?.(event('US', '02108')));
    expect(onCountryInput).toHaveBeenCalledWith('US');
    await act(async () => Promise.resolve());
    expect(mock.update).not.toHaveBeenCalled();
    expect(onReady).toHaveBeenLastCalledWith(false);
  });
});
