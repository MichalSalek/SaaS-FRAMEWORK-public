import type { PropsWithChildren } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import type { PlanCheckoutPanelOrganism } from '../../checkout/PlanCheckoutPanel.organism';
type PlanCheckoutPanelProps = Parameters<typeof PlanCheckoutPanelOrganism>[0];
import type { PlanDecisionSurfaceProps } from '../../shared/pricing/PlanDecisionSurface.organism';
import { OnboardingStepCheckoutOrganism } from './OnboardingStepCheckout.organism';

const trial = vi.hoisted(() => ({ eligible: true }));
vi.mock('../../shared/checkout/hooks/useTrialClaim', () => ({
  useTrialClaim: () => trial.eligible,
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../../../shared/hooks/usePricingFunnelState', () => ({
  usePricingFunnelState: () => ({
    getPricingFunnel: () => ({ promo: 'SAVE' }),
  }),
}));
vi.mock('../../../components/Typography/Typography.atom', () => ({
  TypographyAtom: ({ children }: PropsWithChildren) => <h3>{children}</h3>,
}));
vi.mock('../../../components/Button/Button.atom', () => ({
  ButtonAtom: ({
    children,
    onClick,
  }: PropsWithChildren<{ onClick?: () => void }>) => (
    <button onClick={onClick}>{children}</button>
  ),
}));
vi.mock('../../shared/pricing/PlanDecisionSurface.organism', () => ({
  PlanDecisionSurfaceOrganism: ({
    children,
    title,
    onClose,
    dismissLocked,
  }: PlanDecisionSurfaceProps) => (
    <section role='dialog' aria-label={title}>
      <button disabled={dismissLocked} onClick={onClose}>
        surface back
      </button>
      {typeof children === 'function' ? children(onClose) : children}
    </section>
  ),
}));
vi.mock('../../checkout/PlanCheckoutPanel.organism', () => ({
  PlanCheckoutPanelOrganism: (props: PlanCheckoutPanelProps) => (
    <div>
      <p>
        panel {props.planId} {props.billingPeriod} {props.mode} {props.promo}
      </p>
      <button onClick={() => props.onBusyChange?.(true)}>panel busy</button>
      <button onClick={props.onSuccess}>panel success</button>
    </div>
  ),
}));
vi.mock('./OnboardingPlanChooser.organism', () => ({
  OnboardingPlanChooserOrganism: ({ onProceed }: { onProceed: () => void }) => (
    <button onClick={onProceed}>choose plan</button>
  ),
}));

afterEach(() => {
  trial.eligible = true;
  cleanup();
});
describe('onboarding checkout', () => {
  it.each([PricingPlanValue.PRO, PricingPlanValue.FREE])(
    'keeps %s flow and its busy signal',
    planId => {
      const startFree = vi.fn();
      const busyChange = vi.fn();
      const success = vi.fn();
      render(
        <OnboardingStepCheckoutOrganism
          planId={planId}
          billingPeriod='month'
          onSelectPlan={vi.fn()}
          onSelectBilling={vi.fn()}
          onSuccess={success}
          onStartFree={startFree}
          onCheckoutBusyChange={busyChange}
        />
      );
      fireEvent.click(screen.getByText('choose plan'));
      expect(startFree).toHaveBeenCalledTimes(
        planId === PricingPlanValue.FREE ? 1 : 0
      );
      expect(
        screen.getByText(new RegExp(`panel ${planId} month onboarding`))
      ).toBeInTheDocument();
      fireEvent.click(screen.getByText('panel success'));
      expect(success).toHaveBeenCalledOnce();
      if (planId === PricingPlanValue.FREE) {
        expect(screen.queryByRole('dialog')).toBeNull();
      } else {
        expect(
          screen.getByRole('dialog', { name: 'checkoutDialogTitleTrial' })
        ).toBeInTheDocument();
        fireEvent.click(screen.getByText('surface back'));
        expect(screen.getByText('choose plan')).toBeInTheDocument();
        fireEvent.click(screen.getByText('choose plan'));
        fireEvent.click(screen.getByText('panel busy'));
        expect(busyChange).toHaveBeenCalledWith(true);
        expect(screen.getByText('surface back')).toBeDisabled();
      }
    }
  );
  it('does not promise a trial when the account is ineligible', () => {
    trial.eligible = false;
    render(
      <OnboardingStepCheckoutOrganism
        planId={PricingPlanValue.PRO}
        billingPeriod='month'
        onSelectPlan={vi.fn()}
        onSelectBilling={vi.fn()}
        onSuccess={vi.fn()}
        onStartFree={vi.fn()}
        onCheckoutBusyChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('choose plan'));
    expect(
      screen.getByRole('dialog', { name: 'checkoutDialogTitle' })
    ).toBeInTheDocument();
    expect(screen.queryByText('checkoutSubtitle')).not.toBeInTheDocument();
  });
});
