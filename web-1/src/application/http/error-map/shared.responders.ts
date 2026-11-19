// Responders shared by several domain maps. One function per shared response keeps every member
// of the group byte-identical across domains (it replaced the switch's shared fall-through cases).
import type { NextApiResponse } from 'next';

import {
  respondGeneralError,
  respondPlanLimitReached,
} from '../http.responses.utils';

type PlanLimitError = {
  currentCount: number;
  limit: number;
  planType: string;
};

// GALLERY / PAIRING / SALON_STAFF limit-reached carry the identical { currentCount, limit, planType }
// shape and map to the same 403 plan-limit response (no event argument).
export const respondPlanLimit = (
  res: NextApiResponse,
  error: PlanLimitError
): void =>
  respondPlanLimitReached(res, {
    currentCount: error.currentCount,
    limit: error.limit,
    planType: error.planType,
  });

// Opaque 500: every member is logged server-side at its source; the client never sees the cause
// (function name, service name, Stripe message, configuration detail).
export const respondOpaqueFailure = (res: NextApiResponse): void =>
  respondGeneralError(res, undefined);
