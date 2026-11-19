// application/analytics/tracker-start.helpers.ts
// Pure rules of the tracker start gate (the gate itself: tracker-start.ts).

import { resolvePageKind } from './analytics-page-kind';

export const TRACKER_START = Object.freeze({
  /** Quiet time after `load` before trackers start on their own. */
  QUIET_AFTER_LOAD_MS: 3500,
  /** Longest wait for an idle moment once the quiet time is over. */
  IDLE_TIMEOUT_MS: 2000,
});

/** Parameters that carry the source of a visit (campaign tags, ad click ids). */
const ATTRIBUTION_PARAM =
  /^(?:utm_[a-z_]+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|ttclid|twclid|li_fat_id|epik|rdt_cid|sccid)$/i;

export function hasAttributionParams(search: string): boolean {
  for (const key of new URLSearchParams(search).keys()) {
    if (ATTRIBUTION_PARAM.test(key)) {
      return true;
    }
  }
  return false;
}

/**
 * How long after `load` the trackers wait on their own. Only public marketing
 * and content pages wait (their speed is what search and visitors judge);
 * every other screen, and a landing that carries its source in the address,
 * starts them at the first idle moment, as before: that source exists only in
 * this URL and the first in-app navigation drops it.
 */
export function resolveQuietAfterLoadMs(
  pathname: string,
  search: string
): number {
  if (resolvePageKind(pathname) === 'other' || hasAttributionParams(search)) {
    return 0;
  }
  return TRACKER_START.QUIET_AFTER_LOAD_MS;
}
