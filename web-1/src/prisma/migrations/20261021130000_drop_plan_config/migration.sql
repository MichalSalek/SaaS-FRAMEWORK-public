-- plan_config was never read or written by the app: plan limits live in PRICING_POLICY
-- (.shared-kernel/policies/pricing.policy.ts). Empty on production, no foreign keys point at it.
DROP TABLE IF EXISTS "plan_config";
