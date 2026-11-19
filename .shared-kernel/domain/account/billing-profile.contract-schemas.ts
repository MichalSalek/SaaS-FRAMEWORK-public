import { z } from 'zod';
import { COUNTRY_CODES } from '../localization/country.config';
import type { ParsedData } from '../../policies/validation/validation.zod';

export const billingProfileSchema = z.object({
  has_customer: z.boolean(),
  company_name: z.string().nullable(),
  country: z.enum(COUNTRY_CODES).nullable(),
  address_line1: z.string().nullable(),
  address_line2: z.string().nullable().optional(),
  address_city: z.string().nullable(),
  address_postal_code: z.string().nullable(),
  address_state: z.string().nullable(),
  tax_ids: z.array(
    z.object({
      type: z.string(),
      value: z.string(),
      verification_status: z.string().nullable(),
    })
  ),
  has_company_details: z.boolean(),
});

export type BillingProfile = ParsedData<z.infer<typeof billingProfileSchema>>;
