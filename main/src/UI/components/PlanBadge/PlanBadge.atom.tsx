import {
  getPlanDisplayName,
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import styles from './PlanBadge.module.css';

const PLAN_CLASS: Record<PricingPlan, string> = {
  FREE: styles.free ?? '',
  PRO: styles.pro ?? '',
  PRO_PLUS: styles.proPlus ?? '',
  STUDIO: styles.studio ?? '',
  SCALE: styles.scale ?? '',
};

// DECISION: the label is the kernel display name (getPlanDisplayName), the SAME name as everywhere
// else: PRO_PLUS is "Pro Marka", never "PRO+" (the old name is banned user-facing). The badge no
// longer keeps its own uppercase map; product labels carry no capitals (owner), so the
// badge registry is the name registry.

interface PlanBadgeProps {
  plan: PricingPlan;
  /** Public profile: ink + gold, the premium cue the owner asked for. */
  tone?: 'default' | 'premium';
}

export function PlanBadgeAtom({ plan, tone = 'default' }: PlanBadgeProps) {
  if (plan === PricingPlanValue.FREE) {
    return null;
  }
  return (
    <span
      className={`${styles.badge} ${
        tone === 'premium' ? `${styles.premium} micro-enter` : PLAN_CLASS[plan]
      }`}>
      {getPlanDisplayName(plan)}
    </span>
  );
}
