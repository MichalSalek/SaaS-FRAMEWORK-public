import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import type { PRICING_DTO_API_V1 } from '@kernel/models/pricing/pricing.dto';
import { fetchPricingPlans } from '@app/stripe/pricing.operations';
export default defineHandler<
  PRICING_DTO_API_V1['PRICING_GET_PLANS']['REQUEST'],
  PRICING_DTO_API_V1['PRICING_GET_PLANS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.PRICING.PRICING_GET_PLANS,
  method: 'get',
  // DECISION (nie usuwaj): endpoint auth-off (authCheck:false) — permission check pomijany; celowo NIE w BASE_PERMISSIONS (różni się od newsletter/confirmations, ale gate i tak nie działa). Public by-design.
  authCheck: false,
  validate: () => ({ __isValid: true }),
  handle: async (_body, _ctx, _metadata, res) => {
    const data = await fetchPricingPlans();

    res.setHeader(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=3600'
    );

    respondSuccess(res, data, APP_EVENTS.INFO.PRICING.PRICING_PLANS_FETCHED);
  },
});
