import type { ReactNode } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { CheckoutSuccessOrganism } from './CheckoutSuccess.organism';
import type * as PurchaseResumeModule from '../../../application/client-device-storage/purchase-resume';

const state = vi.hoisted(() => ({
  billing: {
    nextChargeAmount: 1000 as number | null,
    currency: 'pln',
    nextChargeAt: '2026-12-01' as string | null,
  },
  refetch: vi.fn(),
  push: vi.fn(),
  saved: null as unknown,
  consume: vi.fn(),
  hasUploadDraft: true,
}));
vi.mock('./hooks/useResumeUploadDraft', () => ({
  useResumeUploadDraft: () => state.hasUploadDraft,
}));
vi.mock('next/router', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock(
  '../../../application/client-device-storage/purchase-resume',
  async importOriginal => ({
    ...(await importOriginal<typeof PurchaseResumeModule>()),
    readPurchaseResume: () => state.saved,
    consumePurchaseResume: state.consume,
  })
);
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@kernel/domain/user-and-account/subscription-state', () => ({
  resolveSubscriptionState: () => 'trialing',
}));
vi.mock('../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({
    data: {
      stylist_account: { billing: state.billing, trial_ends_at: '2026-12-01' },
    },
    isFetching: false,
    refetch: state.refetch,
  }),
}));
vi.mock('../shared/pricing/hooks/usePricingPlans', () => ({
  usePricingPlans: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock('../../hooks/useCurrentLang', () => ({ useCurrentLang: () => 'pl' }));
vi.mock('../../components/OutcomeFeedback/SuccessScene.organism', () => ({
  SuccessSceneOrganism: ({
    body,
    actions,
  }: {
    body: ReactNode;
    actions: ReactNode;
  }) => (
    <div>
      {body}
      {actions}
    </div>
  ),
}));
vi.mock('../../components/Button/LinkButton.atom', () => ({
  LinkButtonAtom: ({
    children,
    href,
  }: {
    children: ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
vi.mock('../../components/Button/Button.atom', () => ({
  ButtonAtom: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));

afterEach(cleanup);
beforeEach(() => {
  state.hasUploadDraft = true;
  state.billing = {
    nextChargeAmount: 1000,
    currency: 'pln',
    nextChargeAt: '2026-12-01',
  };
  state.refetch.mockReset();
  state.push.mockReset();
  state.consume.mockReset();
  state.saved = null;
});

describe('purchase resume', () => {
  const resume = {
    userId: 'user-a',
    accountId: 'account-a',
    sessionId: 'cs_test_a',
  };
  const saved = {
    id: 'intent-a',
    ...resume,
    createdAt: 100,
    action: { kind: 'upload' },
  };
  it('resumes only on click and consumes after successful navigation', async () => {
    state.saved = saved;
    state.push.mockResolvedValue(true);
    render(
      <CheckoutSuccessOrganism plan={PricingPlanValue.PRO} resume={resume} />
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'resumeUpload' })
    );
    expect(state.push).toHaveBeenCalledWith('/app/gallery/upload-asset');
    await waitFor(() =>
      expect(state.consume).toHaveBeenCalledWith(
        resume,
        'intent-a',
        'cs_test_a'
      )
    );
  });
  it('offers adding a new photo when the saved draft is unavailable on this device', async () => {
    state.hasUploadDraft = false;
    state.saved = saved;
    state.push.mockResolvedValue(true);
    render(
      <CheckoutSuccessOrganism plan={PricingPlanValue.PRO} resume={resume} />
    );
    expect(
      screen.queryByRole('button', { name: 'resumeUpload' })
    ).not.toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole('button', { name: 'resumeUploadNew' })
    );
    await waitFor(() =>
      expect(state.push).toHaveBeenCalledWith('/app/gallery/upload-asset')
    );
  });
  it('preserves the intent if navigation fails', async () => {
    state.saved = saved;
    state.push.mockResolvedValue(false);
    render(
      <CheckoutSuccessOrganism plan={PricingPlanValue.PRO} resume={resume} />
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'resumeUpload' })
    );
    await waitFor(() => expect(state.push).toHaveBeenCalled());
    expect(state.consume).not.toHaveBeenCalled();
  });
  it('does not offer an intent for a different session', () => {
    state.saved = { ...saved, sessionId: 'cs_test_old' };
    render(
      <CheckoutSuccessOrganism plan={PricingPlanValue.PRO} resume={resume} />
    );
    expect(
      screen.queryByRole('button', { name: 'resumeUpload' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'ctaGallery' })
    ).toBeInTheDocument();
  });
});

describe('trial billing details', () => {
  it.each([
    [PricingPlanValue.PRO, 'ctaGallery', '/app/gallery'],
    [
      PricingPlanValue.PRO_PLUS,
      'ctaBrand',
      '/app/profile?profile=personal#brand-colour',
    ],
    [PricingPlanValue.STUDIO, 'start', '/app/profile?profile=salon'],
  ])(
    'opens the selected plan capability after %s activation',
    (plan, label, href) => {
      render(<CheckoutSuccessOrganism plan={plan} />);
      expect(screen.getByRole('link', { name: label })).toHaveAttribute(
        'href',
        href
      );
    }
  );
  it.each([
    ['missing date', 1000, null],
    ['missing amount', null, '2026-12-01'],
  ])('offers refresh for %s', (_label, amount, date) => {
    state.billing.nextChargeAmount = amount;
    state.billing.nextChargeAt = date;
    render(<CheckoutSuccessOrganism plan={PricingPlanValue.PRO} />);
    expect(screen.getByText('billingPending')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ctaRetry' }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });

  it.each([1000, 0])(
    'shows complete details without refresh for amount %s',
    amount => {
      state.billing.nextChargeAmount = amount;
      render(<CheckoutSuccessOrganism plan={PricingPlanValue.PRO} />);
      expect(screen.getByText('firstCharge')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'ctaRetry' })
      ).not.toBeInTheDocument();
    }
  );
});
