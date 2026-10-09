import { PricingPlanValue } from './pricing.config';
import { PRICING_POLICY } from '../../policies/pricing.policy';
import type { PlanConfigType } from '../../policies/pricing.policy';

export type PlanConfigSeedData = {
  plan_id: string;
  max_gallery_records: number;
  max_pinned_records: number;
  max_paired_clients: number;
  max_shares_per_hour: number;
  can_use_session_share: boolean;
  can_use_multi_session: boolean;
  can_use_staff_accounts: boolean;
  is_active: boolean;
};

// DECISION (nie usuwaj tego komentarza): max_staff_members jest limitem CONFIG-ONLY
// (egzekwowany w runtime z PRICING_POLICY w salon-staff ops, NIE persystowany) — tabela
// PlanConfig NIE ma takiej kolumny (świadomie). Projektujemy JAWNIE tylko kolumny DB.
// NIE używać `...PRICING_POLICY.LIMITS.X` — spread przepuszcza pola config-only (TS
// excess-property check nie łapie spreadu) do `planConfig.createMany` -> Prisma rzuca
// "Unknown argument `max_staff_members`". Nowe pole config-only doda się tu samo z siebie
// TYLKO jeśli ktoś je tu jawnie wpisze (i wtedy excess-property check je wychwyci).
const toSeedRow = (
  plan_id: string,
  limits: Readonly<Omit<PlanConfigType, 'plan_id'>>
): PlanConfigSeedData => ({
  plan_id,
  max_gallery_records: limits.max_gallery_records,
  max_pinned_records: limits.max_pinned_records,
  max_paired_clients: limits.max_paired_clients,
  max_shares_per_hour: limits.max_shares_per_hour,
  can_use_session_share: limits.can_use_session_share,
  can_use_multi_session: limits.can_use_multi_session,
  can_use_staff_accounts: limits.can_use_staff_accounts,
  is_active: true,
});

export const PLAN_CONFIG_SEED_DATA: readonly PlanConfigSeedData[] = [
  toSeedRow(PricingPlanValue.FREE, PRICING_POLICY.LIMITS.FREE),
  toSeedRow(PricingPlanValue.PRO, PRICING_POLICY.LIMITS.PRO),
  toSeedRow(PricingPlanValue.PRO_PLUS, PRICING_POLICY.LIMITS.PRO_PLUS),
  toSeedRow(PricingPlanValue.STUDIO, PRICING_POLICY.LIMITS.STUDIO),
  toSeedRow(PricingPlanValue.SCALE, PRICING_POLICY.LIMITS.SCALE),
];
