import type { PropsWithChildren } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import type { PlanChangePreview } from '../hooks/usePlanChangePreview';
import type { PlanDecisionSurfaceProps } from '../../shared/pricing/PlanDecisionSurface.organism';
import type { PlanCheckoutPanelOrganism } from '../../checkout/PlanCheckoutPanel.organism';
type PlanCheckoutPanelProps = Parameters<typeof PlanCheckoutPanelOrganism>[0];
import { PlanCheckoutDialogOrganism } from './PlanCheckoutDialog.organism';
import { PlanChangeConfirmationOrganism } from './PlanChangeConfirmation.organism';
import { DowngradeWarningDialogOrganism } from './DowngradeWarningDialog.organism';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../../shared/checkout/hooks/useTrialClaim', () => ({
  useTrialClaim: () => true,
}));
vi.mock('../../../../application/analytics/posthog-client', () => ({
  capturePosthog: vi.fn(),
}));
vi.mock('../../../components/Button/Button.atom', () => ({
  ButtonAtom: ({
    children,
    onClick,
    disabled,
    loading,
  }: PropsWithChildren<{
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
  }>) => (
    <button disabled={disabled || loading} onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock('../../shared/pricing/PlanDecisionSurface.organism', () => ({
  PlanDecisionSurfaceOrganism: ({
    children,
    title,
    onClose,
    dismissLocked,
    benefits = [],
    role = 'dialog',
    initialFocus,
    backLabel,
  }: PlanDecisionSurfaceProps) => (
    <section
      role={role}
      aria-label={title}
      data-safe-focus={
        initialFocus === 'first' && backLabel === 'cancelCta' ? 'yes' : 'no'
      }>
      <button disabled={dismissLocked} onClick={onClose}>
        surface back
      </button>
      <ul aria-label='benefits'>
        {benefits.map(benefit => (
          <li key={benefit}>{benefit}</li>
        ))}
      </ul>
      {typeof initialFocus === 'function' && (
        <button onClick={() => initialFocus()?.focus()}>focus default</button>
      )}
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
      <button onClick={() => props.onPaymentInFlightChange?.(true)}>
        redirect
      </button>
      <button onClick={() => props.onBusyChange?.(true)}>panel busy</button>
      <button onClick={props.onCancel}>panel cancel</button>
      <button onClick={props.onSuccess}>panel success</button>
    </div>
  ),
}));
vi.mock('./PlanChangeQuote.molecule', () => ({
  PlanChangeQuoteMolecule: ({ rejected }: { rejected: boolean }) => (
    <p>{rejected ? 'quote rejected' : 'quote'}</p>
  ),
}));

afterEach(cleanup);
const preview = {
  canConfirm: true,
  data: { quoteId: 'quote-123' },
} as PlanChangePreview;

describe('plan decision wrappers', () => {
  it('keeps checkout identity and guards both close paths after redirect starts', () => {
    const close = vi.fn();
    render(
      <PlanCheckoutDialogOrganism
        planId={PricingPlanValue.PRO}
        billingPeriod='year'
        promo='SAVE'
        titleId='title'
        title='Buy'
        trialTitle='Trial'
        onClose={close}
      />
    );
    expect(screen.getByRole('dialog', { name: 'Trial' })).toBeInTheDocument();
    expect(
      screen.getByText('panel PRO year account-pay SAVE')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('panel cancel'));
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('redirect'));
    expect(screen.getByText('surface back')).toBeDisabled();
    fireEvent.click(screen.getByText('panel cancel'));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps quote confirmation and disables it for failed or unavailable quotes', () => {
    const confirm = vi.fn();
    const props = {
      planId: PricingPlanValue.PRO_PLUS,
      currentPlan: PricingPlanValue.PRO,
      preview,
      busy: false,
      failed: false,
      onConfirm: confirm,
      onClose: vi.fn(),
    };
    const view = render(<PlanChangeConfirmationOrganism {...props} />);
    expect(screen.getByText('quote')).toBeInTheDocument();
    const gainCount = screen.getByRole('list', { name: 'benefits' }).children
      .length;
    expect(gainCount).toBeGreaterThan(0);
    expect(gainCount).toBeLessThanOrEqual(3);
    fireEvent.click(screen.getByText('confirm'));
    expect(confirm).toHaveBeenCalledWith('quote-123');
    view.rerender(<PlanChangeConfirmationOrganism {...props} failed />);
    expect(screen.getByText('quote rejected')).toBeInTheDocument();
    expect(screen.getByText('confirm')).toBeDisabled();
    view.rerender(
      <PlanChangeConfirmationOrganism
        {...props}
        preview={{ ...preview, canConfirm: false }}
      />
    );
    expect(screen.getByText('confirm')).toBeDisabled();
    view.rerender(<PlanChangeConfirmationOrganism {...props} busy />);
    expect(screen.getByText('surface back')).toBeDisabled();
  });

  it('has no upgrade gains for a billing-period change within the same plan', () => {
    render(
      <PlanChangeConfirmationOrganism
        planId={PricingPlanValue.PRO}
        currentPlan={PricingPlanValue.PRO}
        preview={preview}
        busy={false}
        failed={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(
      screen.getByRole('dialog', { name: 'billingTitle' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('list', { name: 'benefits' }).children
    ).toHaveLength(0);
  });

  it('keeps Studio to Pro Marka losses, quote and safe focus while busy locks Back', () => {
    const confirm = vi.fn();
    const close = vi.fn();
    const props = {
      isOpen: true,
      currentPlan: PricingPlanValue.STUDIO,
      targetPlan: PricingPlanValue.PRO_PLUS,
      stats: null,
      paymentDetails: <p>payment details</p>,
      onClose: close,
      onConfirm: confirm,
    };
    const view = render(<DowngradeWarningDialogOrganism {...props} />);
    expect(
      screen.getByRole('alertdialog', { name: 'paidTitle' })
    ).toHaveAttribute('data-safe-focus', 'yes');
    expect(screen.getByText('lossStaffLabel')).toBeInTheDocument();
    expect(screen.getByText('lossPinnedLabel')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(screen.getByText('surface back'));
    expect(close).toHaveBeenCalledOnce();
    close.mockClear();
    fireEvent.click(screen.getByText('cancelCta'));
    expect(close).toHaveBeenCalledOnce();
    expect(screen.getByText('payment details')).toBeInTheDocument();
    fireEvent.click(screen.getByText('paidConfirmCta'));
    expect(confirm).toHaveBeenCalledOnce();
    view.rerender(<DowngradeWarningDialogOrganism {...props} busy />);
    expect(screen.getByText('surface back')).toBeDisabled();
    expect(screen.getByText('cancelCta')).toBeDisabled();
  });
});
