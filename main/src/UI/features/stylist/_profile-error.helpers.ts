// UI/features/stylist/_profile-error.helpers.ts
// Classifies a failed public-profile query: "this profile does not exist" vs
// "we could not check". Pure (no React, no transport) so the split is unit-tested.

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { isIOError } from '../../../application/http/toPromise.adapter';

// Events the public-profile endpoint answers with when the identifier resolves
// to nothing: ACCOUNT_NOT_FOUND (404: deleted, deactivated, hidden or a typo in
// the link) and VALIDATION_FAILED (400: empty identifier). Everything else
// (network, timeout, 5xx) is "could not check", which must not be reported as
// a missing profile, and vice versa: a dead QR link must not promise that the
// profile still exists and offer a retry that can never succeed.
const PROFILE_NOT_FOUND_EVENTS: ReadonlySet<EVENT_INFO_TYPE> =
  new Set<EVENT_INFO_TYPE>([
    APP_EVENTS.INFO.ACCOUNT.ACCOUNT_NOT_FOUND,
    APP_EVENTS.INFO.APPLICATION.NOT_FOUND,
    APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
  ]);

export function isProfileNotFoundError(error: unknown): boolean {
  return (
    isIOError(error) && PROFILE_NOT_FOUND_EVENTS.has(error.httpError.event)
  );
}
