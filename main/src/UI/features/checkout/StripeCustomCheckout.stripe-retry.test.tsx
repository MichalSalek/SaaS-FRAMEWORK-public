import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadStripe: vi.fn(),
  promises: [] as Promise<unknown>[],
}));
vi.mock('@stripe/stripe-js/pure', () => ({ loadStripe: mocks.loadStripe }));
vi.mock('@stripe/react-stripe-js/checkout', () => ({
  CheckoutProvider: ({
    stripe,
    children,
  }: {
    stripe: Promise<unknown>;
    children: ReactNode;
  }) => {
    mocks.promises.push(stripe);
    return children;
  },
}));
vi.mock('../../../application/environment/environment.config', () => ({
  ENV_VARS: { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_example' },
}));
vi.mock('../../styles/ThemeContext.composition', () => ({
  useTheme: () => ({ resolvedMode: 'light' }),
}));
import { StripeCustomCheckoutOrganism } from './StripeCustomCheckout.organism';

describe('checkout Stripe recovery', () => {
  it('loads Stripe again in the next checkout after a script failure', async () => {
    const stripe = { marker: 'loaded' };
    mocks.loadStripe
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(stripe);
    const view = render(
      <StripeCustomCheckoutOrganism clientSecret='first'>
        payment
      </StripeCustomCheckoutOrganism>
    );
    await expect(mocks.promises.at(-1)).rejects.toThrow('offline');
    view.rerender(
      <StripeCustomCheckoutOrganism clientSecret='second'>
        payment
      </StripeCustomCheckoutOrganism>
    );
    await expect(mocks.promises.at(-1)).resolves.toBe(stripe);
    expect(mocks.loadStripe).toHaveBeenCalledTimes(2);
  });
});
