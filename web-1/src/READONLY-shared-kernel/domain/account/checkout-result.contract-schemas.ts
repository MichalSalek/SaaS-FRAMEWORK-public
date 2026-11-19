import { z } from 'zod';
import { PricingPlanValue } from '../pricing/pricing.config';

export const checkoutResultSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'expired', 'unknown']),
  target: z
    .object({
      planId: z.enum(PricingPlanValue),
      billingPeriod: z.enum(['month', 'year']),
    })
    .nullable(),
});
export type CheckoutResult = z.infer<typeof checkoutResultSchema>;
