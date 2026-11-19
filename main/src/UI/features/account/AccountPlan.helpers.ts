import { formatMoney } from '@kernel/domain/pricing/money.format';
import { TIME } from '@kernel/application/constants.config';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { PLAN_TIER_ORDER } from '@kernel/domain/pricing/pricing-policy';
import { formatDateLong } from '../../../application/date/date.utils';
import { resolvePlanStatusSummary } from './AccountPayPage.helpers';

type PlanAccount = Parameters<typeof resolvePlanStatusSummary>[0];

export function showPlanUpgrade(
  plan: PricingPlan,
  status: ReturnType<typeof resolvePlanStatusSummary>['kind'],
  salonOnly: boolean
): boolean {
  if (salonOnly || status === 'pastDue' || status === 'canceling') {
    return false;
  }
  const currentTier = PLAN_TIER_ORDER.indexOf(
    status === 'free' ? PricingPlanValue.FREE : plan
  );
  return (
    currentTier >= 0 &&
    PLAN_TIER_ORDER.slice(currentTier + 1).some(
      tier => tier !== PricingPlanValue.SCALE
    )
  );
}

export function planHubStatus(
  account: PlanAccount,
  locale: string,
  now = Date.now()
) {
  const status = resolvePlanStatusSummary(account);
  const until = 'until' in status ? status.until : null;
  return {
    kind: status.kind,
    date:
      until === null
        ? ''
        : formatDateLong(until, locale).replaceAll(' ', '\u00a0'),
    days:
      until === null
        ? 0
        : Math.max(
            0,
            Math.ceil((new Date(until).getTime() - now) / TIME.MS_PER_DAY)
          ),
  };
}

export function formatPlanCharge(
  amount: number | null | undefined,
  currency: string | null | undefined,
  locale: string
): string | null {
  if (amount == null || currency == null) {
    return null;
  }
  return formatMoney(amount, currency, locale).replaceAll(' ', '\u00a0');
}
