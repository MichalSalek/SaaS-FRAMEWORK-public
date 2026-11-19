import { z } from 'zod';
import { defineContracts } from '../../application/contracts/contract.types';
import { PricingPlanValue } from './pricing.config';
import { QUERY_FIELD } from '../../application/contracts/query-fields';
import {
  BILLING_CURRENCIES,
  COUNTRY_CODES,
} from '../localization/country.config';

const planId = z.enum(PricingPlanValue);

/**
 * Public price list. `authCheck: false` skips permissions, and the operation is
 * deliberately absent from BASE_PERMISSIONS (`PUBLIC_NO_GRANT`).
 */
export const PRICING_CONTRACTS = defineContracts({
  PRICING_GET_PLANS: {
    summary:
      'Cennik planów: cena miesięczna, cena roczna w ujęciu miesięcznym, waluta i czas pobrania.',
    group: 'PRICING',
    kind: 'QUERY',
    path: 'pricing/get-plans',
    method: 'GET',
    body: null,
    query: { currency: QUERY_FIELD.oneOf(BILLING_CURRENCIES) },
    response: z.object({
      plans: z.array(
        z.object({
          plan_id: planId,
          monthly_price: z.number().nullable(),
          yearly_monthly_price: z.number().nullable(),
          yearly_total: z.number().nullable().optional(),
        })
      ),
      currency: z.enum(BILLING_CURRENCIES),
      is_fallback: z.boolean(),
      fetched_at: z.string(),
    }),
    successEvents: ['PRICING_PLANS_FETCHED'],
    auditEvents: [],
    access: 'PUBLIC_NO_GRANT',
    authCheck: false,
    limiterTier: 'default',
  },
  PRICING_GET_MARKET: {
    summary:
      'Podpowiada kraj i walutę bez zmiany języka ani zapisanego adresu.',
    group: 'PRICING',
    kind: 'QUERY',
    path: 'pricing/get-market',
    method: 'GET',
    body: null,
    query: null,
    response: z.object({
      country_code: z.enum(COUNTRY_CODES).nullable(),
      currency: z.enum(BILLING_CURRENCIES),
      source: z.enum(['ip', 'fallback']),
      international_billing_enabled: z.boolean(),
    }),
    successEvents: ['PRICING_PLANS_FETCHED'],
    auditEvents: [],
    access: 'PUBLIC_NO_GRANT',
    authCheck: false,
    limiterTier: 'default',
  },
});

export type PricingContracts = typeof PRICING_CONTRACTS;
