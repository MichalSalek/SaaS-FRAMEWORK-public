import type { NextApiResponse } from 'next';
import { getFeatureFlags } from './feature-flags.cache';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { respondNotFound } from '@app/http/http.responses.utils';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

// DECISION: back-guard for the SALON_STAFF_ENABLED kill-switch. It reads the LIVE flag from
// getFeatureFlags() (DB + cache, reactive to the admin toggle), not FEATURE_FLAG_DEFAULTS and not
// the public endpoint (the flag is not in PUBLIC_FEATURE_FLAG_KEYS). SECURITY: the front route
// gate only hides UI; without this guard flag=false leaves api/v1/salon/staff/** open (IDOR
// bypass). It lives in the handlers, after RBAC (requireStylistAccount) and before the operation,
// because operations take only {accountId, pricingPlan} without currentUser.
//
// Disabled -> 404 NOT_FOUND, not 403: it masks the feature's existence, consistent with the
// front gate (notFound) and the IDOR masking in error-mapper (SUPPORT_THREAD_NOT_AUTHORIZED ->
// 404). Fail-closed: if getFeatureFlags throws, the error propagates to timing.middleware (500)
// and the operation does not run. Returns true = enabled (continue), false = disabled (response
// already sent, the handler MUST `return`).
export const requireSalonStaffEnabled = async (
  res: NextApiResponse
): Promise<boolean> => {
  const flags = await getFeatureFlags();
  const enabled = flags.get(FEATURE_FLAG_KEYS.SALON_STAFF_ENABLED) ?? false;
  if (!enabled) {
    respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, undefined);
    return false;
  }
  return true;
};

// DECISION: same back-guard as requireSalonStaffEnabled, for EXPLORE_ENABLED (kernel default
// OFF): without it flag=false leaves api/v1/gallery/explore open. Fail-closed (?? false). Same
// return contract.
export const requireExploreEnabled = async (
  res: NextApiResponse
): Promise<boolean> => {
  const flags = await getFeatureFlags();
  const enabled = flags.get(FEATURE_FLAG_KEYS.EXPLORE_ENABLED) ?? false;
  if (!enabled) {
    respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, undefined);
    return false;
  }
  return true;
};
