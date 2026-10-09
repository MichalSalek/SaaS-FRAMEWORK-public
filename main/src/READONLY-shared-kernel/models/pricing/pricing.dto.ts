import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { PricingPlan } from '../../domain/pricing/pricing.config';

export type PricingPlanPrice = {
  plan_id: PricingPlan;
  monthly_price: number | null;
  yearly_monthly_price: number | null;
};

export type PricingPlansResponse = {
  plans: PricingPlanPrice[];
  currency: string;
  is_fallback: boolean;
  fetched_at: string;
};

export type PRICING_DTO_API_V1 = {
  /** Zwraca cennik planów (ceny miesięczne oraz roczne w ujęciu miesięcznym), walutę, znacznik fallbacku i czas pobrania. */
  PRICING_GET_PLANS: {
    REQUEST: undefined;
    RESPONSE: PricingPlansResponse;
    RESPONSE_ERROR: DetailedErrorPayload<Record<string, never>>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      PRICING_DTO_API_V1['PRICING_GET_PLANS']['REQUEST'],
      PRICING_DTO_API_V1['PRICING_GET_PLANS']['RESPONSE'],
      PRICING_DTO_API_V1['PRICING_GET_PLANS']['RESPONSE_ERROR']
    >;
  };
};
