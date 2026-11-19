import type { z } from 'zod';
import type { ACCOUNT_DTO_API_V1 } from '../../models/account/account.dto';
import {
  checkoutSessionSchema,
  planChangeSchema,
  stripePortalSchema,
} from '../../domain/account/account.contract-schemas';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

export const checkoutValidators = {
  stripePortal: (data: unknown) => zodValidate(stripePortalSchema, data),
  checkoutSession: (data: unknown) => zodValidate(checkoutSessionSchema, data),
  planChange: (data: unknown) => zodValidate(planChangeSchema, data),
} as const;

export type CheckoutRequestSchemaBindings = {
  checkoutSession: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof checkoutSessionSchema>,
      ACCOUNT_DTO_API_V1['ACCOUNT_CHECKOUT_SESSION']['REQUEST']
    >
  >;
  planChange: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof planChangeSchema>,
      ACCOUNT_DTO_API_V1['ACCOUNT_PLAN_CHANGE']['REQUEST']
    >
  >;
};
