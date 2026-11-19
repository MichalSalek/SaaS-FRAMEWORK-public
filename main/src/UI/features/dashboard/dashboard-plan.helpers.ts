import type { EffectivePlanFields } from '@kernel/domain/pricing/effective-plan';
import { TIME } from '@kernel/application/constants.config';
import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import {
  PLAN_DISPLAY_NAMES,
  PricingPlanValue,
} from '@kernel/domain/pricing/pricing.config';
import { formatDateLong } from '../../../application/date/date.utils';
import { resolvePlanStatusSummary } from '../account/AccountPayPage.helpers';

type Account = Parameters<typeof resolvePlanStatusSummary>[0];

/** Share the billing state precedence with the Plan hub; dates and day units
 * remain whole pieces while the shared navigation row wraps on a phone. */
export function resolveDashboardPlanLine(
  account: Account & EffectivePlanFields,
  locale: string,
  now = Date.now()
) {
  const summary = resolvePlanStatusSummary(account);
  if (account.salon_plan) {
    return {
      key:
        summary.kind === 'free'
          ? ('salonMember' as const)
          : ('salonMemberWithOwn' as const),
      values: {
        plan: PLAN_DISPLAY_NAMES[account.salon_plan.pricing_plan],
        salon: account.salon_plan.salon_name,
        ownPlan: PLAN_DISPLAY_NAMES[account.pricing_plan],
        date: '',
        days: 0,
      },
    };
  }
  const date =
    'until' in summary
      ? formatDateLong(summary.until, locale).replaceAll(' ', '\u00a0')
      : '';
  const cancelingTrial =
    summary.kind === 'canceling' &&
    account.subscription_status === SubscriptionStatusValue.TRIALING;
  const days =
    summary.kind === 'trialing' || cancelingTrial
      ? Math.max(
          0,
          Math.ceil(
            (new Date('until' in summary ? summary.until : now).getTime() -
              now) /
              TIME.MS_PER_DAY
          )
        )
      : 0;
  return {
    key: cancelingTrial ? ('cancelingTrial' as const) : summary.kind,
    values: {
      plan: PLAN_DISPLAY_NAMES[
        summary.kind === 'free' ? PricingPlanValue.FREE : account.pricing_plan
      ],
      date,
      days,
    },
  };
}
