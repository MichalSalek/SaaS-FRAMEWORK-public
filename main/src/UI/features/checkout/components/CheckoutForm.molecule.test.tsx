import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import type { CheckoutFormTranslations } from './CheckoutForm.types';
import { CheckoutFormMolecule } from './CheckoutForm.molecule';

const state = vi.hoisted(() => ({
  clicked: vi.fn(),
  declined: vi.fn(),
  confirm: vi.fn(),
  confirmed: vi.fn(),
  updateCompany: vi.fn(),
  validate: vi.fn(),
  portalIntent: vi.fn(),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@stripe/react-stripe-js/checkout', () => ({
  useCheckout: () => ({
    type: 'success',
    checkout: {
      id: 'cs_test_owned',
      currency: 'usd',
      confirm: state.confirm,
      total: { total: { minorUnitsAmount: 7900 } },
    },
  }),
}));
vi.mock('./useCheckoutElementAutofocus', () => ({
  useCheckoutElementAutofocus: () => {},
}));
vi.mock('../hooks/useVatInvoiceForm', () => ({
  useVatInvoiceForm: () => ({
    isOn: true,
    form: { companyName: 'Salon' },
    validate: state.validate,
  }),
}));
vi.mock('../hooks/useCheckoutTaxPortal', () => ({
  useCheckoutTaxPortal: (intent: unknown) => {
    state.portalIntent(intent);
    return { busy: false, isBusy: () => false, open: vi.fn() };
  },
}));
vi.mock('../checkout-summary.helpers', () => ({
  buildCheckoutSummaryModel: () => ({ kind: 'pay' }),
}));
vi.mock('../checkout-act.helpers', () => ({
  resolveCheckoutAct: () => ({
    payNow: 'Pay',
    processing: 'Processing',
    confirmError: 'Error',
    stillProcessing: 'Waiting',
    amountUnknown: false,
  }),
}));
vi.mock('./PlanCheckoutSummary.molecule', () => ({
  PlanCheckoutSummaryMolecule: () => null,
}));
vi.mock('./CheckoutPaymentDetails.organism', () => ({
  CheckoutPaymentDetailsOrganism: ({
    billing: {
      needsAddress,
      requiresTaxReview,
      setSharedAddress: onAddressChange,
      setReady: onReady,
    },
  }: {
    billing: {
      needsAddress: boolean;
      requiresTaxReview?: boolean;
      setSharedAddress: (contact: unknown) => void;
      setReady: (ready: boolean) => void;
    };
  }) => (
    <>
      {needsAddress && (
        <button
          onClick={() => {
            onAddressChange({
              address: {
                country: 'US',
                line1: '1 Main St',
                line2: 'Apt 12',
                city: 'Boston',
                postal_code: '02108',
              },
            });
            onReady(true);
          }}>
          Complete US address
        </button>
      )}
      {requiresTaxReview && <p>Review saved tax IDs</p>}
    </>
  ),
}));
vi.mock('./CheckoutActions.molecule', () => ({
  CheckoutActionsMolecule: ({
    onPay,
    disabled,
    needsCompanyUpdate,
    error,
  }: {
    onPay: () => void;
    disabled: boolean;
    needsCompanyUpdate: boolean;
    error: string | null;
  }) => (
    <>
      <button onClick={onPay} disabled={disabled}>
        {needsCompanyUpdate ? 'Update company' : 'Pay'}
      </button>
      {error && <p role='alert'>{error}</p>}
    </>
  ),
}));
vi.mock('./updateCheckoutCompany', () => ({
  updateCheckoutCompany: state.updateCompany,
}));
vi.mock('./checkout-pay.helpers', () => ({
  PAY_TIMING: { CONFIRM_STALL_MS: 20000, REDIRECT_OVERDUE_MS: 15000 },
  clearCheckoutWatchdog: (ref: {
    current: ReturnType<typeof setTimeout> | null;
  }) => {
    if (ref.current !== null) {
      clearTimeout(ref.current);
    }
    ref.current = null;
  },
  checkoutMarket: (
    billingCountry: string | undefined,
    currency: string,
    billingPeriod: string
  ) => ({ billingCountry, currency, billingPeriod }),
  payFlow: {
    clicked: state.clicked,
    declined: state.declined,
    threw: vi.fn(),
    succeeded: vi.fn(),
  },
}));

const tx = { vatSaveError: 'Company save failed' } as CheckoutFormTranslations;
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.validate.mockReturnValue(true);
  state.updateCompany.mockResolvedValue(undefined);
  state.confirm.mockResolvedValue({
    type: 'error',
    error: { code: 'paymentFailed', paymentFailed: { declineCode: null } },
  });
});
function renderForm(
  options: {
    country?: 'PL';
    required?: boolean;
    profileUnverified?: boolean;
    profile?: React.ComponentProps<
      typeof CheckoutFormMolecule
    >['billingProfile'];
  } = { country: 'PL' }
) {
  render(
    <CheckoutFormMolecule
      planId={PricingPlanValue.PRO}
      billingPeriod='month'
      {...(options.country && { billingCountry: options.country })}
      {...(options.required && { billingAddressRequired: true })}
      {...(options.profile && { billingProfile: options.profile })}
      {...(options.profileUnverified && { billingProfileUnverified: true })}
      currency='eur'
      onConfirmed={state.confirmed}
      onCancel={undefined}
      tx={tx}
    />
  );
}

describe('checkout payment attempt tracking with company details', () => {
  it('checks the owned result after a lost confirmation response instead of confirming again', async () => {
    state.confirm.mockRejectedValueOnce(new Error('network'));
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Update company' }));
    await waitFor(() => expect(state.updateCompany).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: 'Pay' }));
    fireEvent.click(await screen.findByRole('button', { name: 'checkResult' }));
    expect(state.confirm).toHaveBeenCalledTimes(1);
    expect(state.confirmed).toHaveBeenCalledWith('cs_test_owned');
  });
  it('blocks company preview and confirmation while the saved fiscal profile is unverified', () => {
    renderForm({ country: 'PL', profileUnverified: true });
    const pay = screen.getByRole('button', { name: 'Update company' });
    expect(pay).toBeDisabled();
    fireEvent.click(pay);
    expect(state.updateCompany).not.toHaveBeenCalled();
    expect(state.confirm).not.toHaveBeenCalled();
  });
  it('accepts a complete US address with no country hint and sends its country to the company preview', async () => {
    renderForm({});
    expect(
      screen.getByRole('button', { name: 'Update company' })
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Complete US address' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Update company' }));
    await waitFor(() => expect(state.updateCompany).toHaveBeenCalledOnce());
    expect(state.updateCompany).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'US',
      expect.objectContaining({
        address: expect.objectContaining({ country: 'US', line2: 'Apt 12' }),
      })
    );
    expect(state.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }));
    await waitFor(() => expect(state.confirm).toHaveBeenCalledOnce());
    expect(state.clicked).toHaveBeenCalledWith(
      PricingPlanValue.PRO,
      expect.objectContaining({ billingCountry: 'US', currency: 'usd' }),
      'payment'
    );
  });
  it('requires portal review before confirming a different actual country with saved tax IDs', () => {
    renderForm({
      country: 'PL',
      required: true,
      profile: {
        has_customer: true,
        company_name: 'Salon',
        country: 'PL',
        address_line1: 'A',
        address_city: 'Krakow',
        address_postal_code: '30-001',
        address_state: null,
        has_company_details: true,
        tax_ids: [
          { type: 'eu_vat', value: 'PL1234567890', verification_status: null },
        ],
      },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Complete US address' })
    );
    expect(screen.getByText('Review saved tax IDs')).toBeInTheDocument();
    expect(state.portalIntent).toHaveBeenLastCalledWith(
      expect.objectContaining({ billingCountry: 'US', currency: 'eur' })
    );
    expect(
      screen.getByRole('button', { name: 'Update company' })
    ).toBeDisabled();
    expect(state.updateCompany).not.toHaveBeenCalled();
    expect(state.confirm).not.toHaveBeenCalled();
  });
  it('tracks only the second action that actually confirms', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Update company' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pay' })).toBeInTheDocument()
    );
    expect(state.updateCompany).toHaveBeenCalledOnce();
    expect(state.clicked).not.toHaveBeenCalled();
    expect(state.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }));
    await waitFor(() => expect(state.confirm).toHaveBeenCalledOnce());
    expect(state.clicked).toHaveBeenCalledExactlyOnceWith(
      PricingPlanValue.PRO,
      { billingCountry: 'PL', currency: 'usd', billingPeriod: 'month' },
      'payment'
    );
    expect(state.declined).toHaveBeenCalledWith(
      PricingPlanValue.PRO,
      { code: 'paymentFailed', paymentFailed: { declineCode: null } },
      { billingCountry: 'PL', currency: 'usd', billingPeriod: 'month' },
      'payment'
    );
    expect(state.clicked.mock.invocationCallOrder[0]).toBeLessThan(
      state.confirm.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('does not track payment when company details cannot be saved', async () => {
    state.updateCompany.mockRejectedValue(new Error('save failed'));
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Update company' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Company save failed'
    );
    expect(state.confirm).not.toHaveBeenCalled();
    expect(state.clicked).not.toHaveBeenCalled();
  });

  it('does not track payment when company validation fails', () => {
    state.validate.mockReturnValue(false);
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Update company' }));
    expect(state.updateCompany).not.toHaveBeenCalled();
    expect(state.confirm).not.toHaveBeenCalled();
    expect(state.clicked).not.toHaveBeenCalled();
  });
});
