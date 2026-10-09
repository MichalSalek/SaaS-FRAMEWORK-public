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

// DECISION (nie usuwaj tego komentarza):
// Etykieta = display-name z kernela (getPlanDisplayName), TA SAMA nazwa co
// wszędzie: po repricingu 2026-07-10 PRO_PLUS = „Pro Marka" (NIE „PRO+", stara
// nazwa jest zakazana user-facing, S53 /spar). Do S108 badge nosił własną
// mapę WIELKIMI LITERAMI jako osobny rejestr; głos ownera 2 i 4 (2026-09-06)
// zdjął kapitaliki z etykiet produktu, więc rejestr badge'a = rejestr nazwy.

interface PlanBadgeProps {
  plan: PricingPlan;
}

export function PlanBadgeAtom({ plan }: PlanBadgeProps) {
  if (plan === PricingPlanValue.FREE) {
    return null;
  }
  return (
    <span className={`${styles.badge} ${PLAN_CLASS[plan]}`}>
      {getPlanDisplayName(plan)}
    </span>
  );
}
