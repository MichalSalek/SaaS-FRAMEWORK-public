import type { PricingPlan } from '../pricing/pricing.config';

export type ClientCardPlanLockedError = {
  type: 'CLIENT_CARD_PLAN_LOCKED';
  planType: PricingPlan;
};

export type VisitNotFoundError = {
  type: 'VISIT_NOT_FOUND';
  visitId: string;
};

export type VisitError = ClientCardPlanLockedError | VisitNotFoundError;
