import { useId } from 'react';
import { useTranslations } from 'next-intl';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import type { PricingPlanCard } from '../../shared/pricing/hooks/usePricingPlans';
import { PlanCheckoutDialogOrganism } from './PlanCheckoutDialog.organism';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { useAccountPayActions } from '../hooks/useAccountPayActions';
import type { PlanChangePreview } from '../hooks/usePlanChangePreview';
import type { DowngradeWarningStats } from './downgradeWarning.helpers';
import { PlanChangeQuoteMolecule } from './PlanChangeQuote.molecule';
import { PlanChangeConfirmationOrganism } from './PlanChangeConfirmation.organism';
import { DowngradeWarningDialogOrganism } from './DowngradeWarningDialog.organism';

export function AccountPayDialogsOrganism({
  actions,
  currentPlan,
  preview,
  stats,
  plans,
  billingPeriod,
  promo,
  source,
}: {
  actions: ReturnType<typeof useAccountPayActions>;
  currentPlan: PricingPlan;
  preview: PlanChangePreview;
  stats: DowngradeWarningStats | null;
  plans: readonly PricingPlanCard[];
  billingPeriod: BillingPeriod;
  promo: string | undefined;
  source?: 'onboarding' | 'account-pay';
}) {
  const t = useTranslations('account.pay');
  const checkoutDialogTitleId = useId();
  const checkoutPlanData = plans.find(plan => plan.id === actions.checkoutPlan);
  return (
    <>
      {actions.upgradeTarget !== null && (
        <PlanChangeConfirmationOrganism
          planId={actions.upgradeTarget}
          currentPlan={currentPlan}
          preview={preview}
          busy={actions.busy}
          failed={
            actions.failedPlan === actions.upgradeTarget &&
            actions.failedQuoteId === preview.data?.quoteId
          }
          onClose={actions.cancelUpgrade}
          onConfirm={actions.confirmUpgrade}
        />
      )}

      <DowngradeWarningDialogOrganism
        isOpen={actions.downgradeTarget !== null}
        onClose={actions.cancelDowngrade}
        onConfirm={() =>
          actions.confirmDowngrade(
            preview.canConfirm ? preview.data?.quoteId : undefined
          )
        }
        confirmDisabled={
          actions.downgradeTarget !== PricingPlanValue.FREE &&
          (!preview.canConfirm ||
            actions.failedQuoteId === preview.data?.quoteId)
        }
        busy={actions.busy}
        paymentDetails={
          actions.downgradeTarget !== null &&
          actions.downgradeTarget !== PricingPlanValue.FREE ? (
            <PlanChangeQuoteMolecule
              preview={preview}
              rejected={
                actions.failedPlan === actions.downgradeTarget &&
                actions.failedQuoteId === preview.data?.quoteId
              }
            />
          ) : undefined
        }
        stats={stats}
        currentPlan={currentPlan}
        targetPlan={actions.downgradeTarget ?? PricingPlanValue.FREE}
      />
      {/* FREE → paid: embedded checkout dialog (no portal bounce). Only a real,
          known paid plan opens it. */}
      {actions.checkoutPlan !== null && checkoutPlanData !== undefined && (
        <PlanCheckoutDialogOrganism
          planId={actions.checkoutPlan}
          billingPeriod={billingPeriod}
          {...(source && { source })}
          {...(promo !== undefined ? { promo: promo } : {})}
          titleId={checkoutDialogTitleId}
          title={t('checkoutDialogTitle', { plan: checkoutPlanData.name })}
          trialTitle={t('checkoutDialogTitleTrial', {
            plan: checkoutPlanData.name,
          })}
          onClose={actions.checkoutClose}
        />
      )}
    </>
  );
}
