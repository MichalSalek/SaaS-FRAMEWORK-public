import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { StripeCheckoutOptions } from '@stripe/stripe-js';
import type { BillingProfile } from '@kernel/domain/account/billing-profile.contract-schemas';

const observed = vi.hoisted(() => ({ options: [] as StripeCheckoutOptions[] }));
vi.mock('@stripe/react-stripe-js/checkout', () => ({
  CheckoutProvider: ({
    options,
    children,
  }: {
    options: StripeCheckoutOptions;
    children: ReactNode;
  }) => {
    observed.options.push(options);
    return <>{children}</>;
  },
}));
vi.mock('@stripe/stripe-js/pure', () => ({
  loadStripe: vi.fn(async () => null),
}));
vi.mock('../../../application/environment/environment.config', () => ({
  ENV_VARS: { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: '' },
}));
vi.mock('../../styles/ThemeContext.composition', () => ({
  useTheme: () => ({ resolvedMode: 'light' }),
}));
import { StripeCustomCheckoutOrganism } from './StripeCustomCheckout.organism';

const profile: BillingProfile = {
  has_customer: true,
  company_name: 'Salon Ltd',
  country: 'US',
  address_line1: '1 Main St',
  address_line2: 'Apt 12',
  address_city: 'Boston',
  address_postal_code: '02108',
  address_state: 'MA',
  tax_ids: [],
  has_company_details: true,
};

describe('Stripe checkout address defaults', () => {
  it('prefills the saved billing address even if the detected country differs', () => {
    observed.options.length = 0;
    render(
      <StripeCustomCheckoutOrganism
        clientSecret='session_1'
        billingCountry='CA'
        billingProfile={profile}>
        payment
      </StripeCustomCheckoutOrganism>
    );
    expect(
      observed.options.at(-1)?.defaultValues?.billingAddress
    ).toMatchObject({
      name: 'Salon Ltd',
      address: { country: 'US', line1: '1 Main St', line2: 'Apt 12' },
    });
  });
  it('does not fabricate a default country when neither profile nor hint exists', () => {
    observed.options.length = 0;
    render(
      <StripeCustomCheckoutOrganism clientSecret='unknown'>
        payment
      </StripeCustomCheckoutOrganism>
    );
    expect(
      observed.options.at(-1)?.defaultValues?.billingAddress
    ).toBeUndefined();
  });
  it('prefills a matching saved address and keeps the snapshot until a new session', () => {
    observed.options.length = 0;
    const view = render(
      <StripeCustomCheckoutOrganism
        clientSecret='session_1'
        billingCountry='US'
        billingProfile={profile}>
        payment
      </StripeCustomCheckoutOrganism>
    );
    const first = observed.options.at(-1);
    expect(first?.defaultValues?.billingAddress).toEqual({
      name: 'Salon Ltd',
      address: {
        country: 'US',
        line1: '1 Main St',
        line2: 'Apt 12',
        city: 'Boston',
        postal_code: '02108',
        state: 'MA',
      },
    });
    const refreshed = {
      ...profile,
      company_name: 'Changed in background',
      address_line2: 'Apt 13',
    };
    view.rerender(
      <StripeCustomCheckoutOrganism
        clientSecret='session_1'
        billingCountry='US'
        billingProfile={refreshed}>
        payment
      </StripeCustomCheckoutOrganism>
    );
    expect(observed.options.at(-1)).toBe(first);
    view.rerender(
      <StripeCustomCheckoutOrganism
        clientSecret='session_2'
        billingCountry='US'
        billingProfile={refreshed}>
        payment
      </StripeCustomCheckoutOrganism>
    );
    expect(
      observed.options.at(-1)?.defaultValues?.billingAddress
    ).toMatchObject({
      name: 'Changed in background',
      address: { line2: 'Apt 13' },
    });
  });
});
