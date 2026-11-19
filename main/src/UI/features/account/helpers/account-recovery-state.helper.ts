// UI/features/account/helpers/account-recovery-state.helper.ts
// ADRR Model A (§13.1) — client-side computation of the account recovery state
// from the SafeCurrentUser fields exposed by GET /api/v1/session/get-current.
//
// DECISION: state is DERIVED from 3 fields (is_active, deleted_at, recovery_available), NOT a
// server-sent enum: this is the kernel contract (session.dto.ts SafeCurrentUser DECISION block).
// Three states per DOMAIN_SSOT §13.1:
//   - ACTIVE:      is_active=true,  deleted_at=null, recovery_available=false
//   - RECOVERABLE: is_active=false, deleted_at=set,  recovery_available=true
//   - EXPIRED:     is_active=false, deleted_at=set,  recovery_available=false
// `days_left` = ceil((deleted_at + 90d - now) / day), clamped to the configured window. Recovery is POST-login and
// state-driven (zero enumeration), never an e-mail check.

import { TIME } from '@kernel/application/constants.config';
import { RECOVERY_CONFIG } from '@kernel/domain/recovery/deleted-user-backup.types';
import type { SafeCurrentUserWire } from '@kernel/domain/user/user.contract-schemas';

export type AccountRecoveryState = 'active' | 'recoverable' | 'expired';

const MS_PER_DAY = TIME.MS_PER_DAY;

/**
 * Derive the recovery state from the current user. Defaults to ACTIVE when the
 * user is undefined (loading / logged-out) so callers never gate the app on a
 * transient null — the app shell renders normally until the query resolves.
 */
export function deriveAccountRecoveryState(
  user: SafeCurrentUserWire | undefined
): AccountRecoveryState {
  if (!user) {
    return 'active';
  }
  if (user.is_active) {
    return 'active';
  }
  // is_active === false below. Distinguish RECOVERABLE vs EXPIRED by the
  // recovery_available flag. Admin-ban (deleted_at === null) is NOT part of the
  // recovery flow and is intentionally NOT a recovery state here (see DECISION).
  if (user.deleted_at !== null && user.recovery_available) {
    return 'recoverable';
  }
  // DECISION: EXPIRED (is_active=false, deleted_at=set, recovery_available=false) is a legacy
  // fail-safe. Since the recovery migration to 90d the cleanup interceptor MOVES the row
  // (moveExpiredUserToArchive_IO) after 90d instead of flipping recovery_available to false, so no
  // path produces this state any more. The branch stays in case a flip-instead-of-MOVE regime ever
  // exists again; do NOT remove it.
  if (user.deleted_at !== null) {
    return 'expired';
  }
  // DECISION: is_active=false with deleted_at===null means ADMIN-BAN / self-disable (NOT a
  // soft-delete); 'active' is returned on purpose. It is not a recovery state and there is no
  // dedicated ban guard here. A banned user is evicted by the event pipeline, not the recovery guard:
  // the backend account-state-guard returns 403 with USER_DISABLED, mapped in
  // CRITICAL_REDIRECTIONS_ON_EVENTS (→ USER_LOG, UNCONDITIONAL + STATE_FULL_RESET) for a graceful
  // logout + redirect. We do NOT force-redirect to /recover: a banned user has nothing to recover
  // and the recover screen would be the wrong surface.
  return 'active';
}

/**
 * Days remaining in the 90-day recovery window (RECOVERY_CONFIG.MAX_DAYS).
 * Returns null when there is no deletion timestamp. Clamp both bounds so clock
 * skew cannot promise extra days and an elapsed window cannot show a negative numeral.
 * Display only: the backend owns recovery eligibility and expiration.
 */
export function getRecoveryDaysLeft(
  deletedAt: SafeCurrentUserWire['deleted_at'] | undefined
): number | null {
  if (deletedAt === null || deletedAt === undefined) {
    return null;
  }
  // The wire contract supplies an ISO timestamp.
  const deletedMs = new Date(deletedAt).getTime();
  if (Number.isNaN(deletedMs)) {
    return null;
  }
  const expiryMs = deletedMs + RECOVERY_CONFIG.MAX_DAYS * MS_PER_DAY;
  const remainingMs = expiryMs - Date.now();
  return Math.min(
    RECOVERY_CONFIG.MAX_DAYS,
    Math.max(0, Math.ceil(remainingMs / MS_PER_DAY))
  );
}
