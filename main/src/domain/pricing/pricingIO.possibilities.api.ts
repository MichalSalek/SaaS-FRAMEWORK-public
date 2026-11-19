import { contractEndpoint } from '../../application/http/io';
import { PRICING_CONTRACTS } from '@kernel/domain/pricing/pricing.contracts';

export const getPricingPlans_IO = contractEndpoint(
  PRICING_CONTRACTS.PRICING_GET_PLANS
);

export const getPricingMarket_IO = contractEndpoint(
  PRICING_CONTRACTS.PRICING_GET_MARKET,
  { successFeedback: 'silent', errorFeedbackPolicy: 'background' }
);
