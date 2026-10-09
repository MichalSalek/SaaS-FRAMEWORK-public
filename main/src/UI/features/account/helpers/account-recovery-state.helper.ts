// UI/features/account/helpers/account-recovery-state.helper.ts
// ADRR Model A (§13.1) — client-side computation of the account recovery state
// from the SafeCurrentUser fields exposed by GET /api/v1/session/get-current.
//
// DECISION (nie usuwaj tego komentarza):
// State is DERIVED from 3 fields (is_active, deleted_at, recovery_available),
// NOT a server-sent enum — this is the kernel contract (session.dto.ts
// SafeCurrentUser DECISION block). Three states per §13.1:
//   - ACTIVE:      is_active=true,  deleted_at=null, recovery_available=false
//   - RECOVERABLE: is_active=false, deleted_at=set,  recovery_available=true
//   - EXPIRED:     is_active=false, deleted_at=set,  recovery_available=false
// `days_left` = ceil((deleted_at + 90d - now) / day), clamped to >= 0. Recovery
// is POST-login + state-driven (zero enumeration) — never an email check.

import { TIME } from '@kernel/application/constants.config';
import { RECOVERY_CONFIG } from '@kernel/domain/recovery/deleted-user-backup.types';
import type { SafeCurrentUser } from '@kernel/models/session/session.dto';

export type AccountRecoveryState = 'active' | 'recoverable' | 'expired';

const MS_PER_DAY = TIME.MS_PER_DAY;

/**
 * Derive the recovery state from the current user. Defaults to ACTIVE when the
 * user is undefined (loading / logged-out) so callers never gate the app on a
 * transient null — the app shell renders normally until the query resolves.
 */
export function deriveAccountRecoveryState(
  user: SafeCurrentUser | undefined
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
  // DECISION (nie usuwaj tego komentarza):
  // EXPIRED (is_active=false, deleted_at=set, recovery_available=false) = legacy/
  // defensive fail-safe. Po migracji recovery 30d→90d (FAZA C) interceptor
  // robi MOVE (moveExpiredUserToArchive_IO) — hard-deletuje row po 90d zamiast
  // flipować recovery_available do false — więc ŻADNA ścieżka już nie produkuje
  // tego stanu (poprzedni 30d-flip do EXPIRED został usunięty). Gałąź zachowana
  // jako fail-safe (gdyby kiedyś istniał reżim flip-zamiast-MOVE), NIE usuwać.
  if (user.deleted_at !== null) {
    return 'expired';
  }
  // DECISION (nie usuwaj tego komentarza):
  // is_active=false ale deleted_at===null ⇒ ADMIN-BAN / self-disable (NIE
  // soft-delete). Świadomie zwracamy 'active' — to NIE jest recovery state i NIE
  // ma dedykowanego ban-guarda (taki guard nie istnieje, poprzedni komentarz był
  // nieaktualny). Eviction banned-usera NIE idzie przez recovery guard, tylko
  // przez event pipeline: backend account-state-guard zwraca 403 z event
  // USER_DISABLED, a USER_DISABLED jest zmapowany w CRITICAL_REDIRECTIONS_ON_EVENTS
  // (→ USER_LOG, UNCONDITIONAL + STATE_FULL_RESET) → graceful logout+redirect.
  // Tutaj NIE force-redirectujemy na /recover, bo banned user nie ma czego
  // odzyskiwać (brak soft-delete) — recover screen byłby błędną powierzchnią.
  return 'active';
}

/**
 * Days remaining in the 90-day recovery window (RECOVERY_CONFIG.MAX_DAYS).
 * Returns null when there is no deletion timestamp. Clamped to >= 0 so an
 * already-elapsed window never shows a negative numeral — once the window
 * lapses the MOVE interceptor hard-deletes the row (it does NOT flip to a
 * lingering EXPIRED state), so the user simply can no longer log in.
 */
export function getRecoveryDaysLeft(
  deletedAt: SafeCurrentUser['deleted_at'] | undefined
): number | null {
  if (deletedAt === null || deletedAt === undefined) {
    return null;
  }
  // deleted_at is typed as Date in the DTO but arrives as an ISO string over
  // JSON — new Date(...) handles both shapes.
  const deletedMs = new Date(deletedAt).getTime();
  if (Number.isNaN(deletedMs)) {
    return null;
  }
  const expiryMs = deletedMs + RECOVERY_CONFIG.MAX_DAYS * MS_PER_DAY;
  const remainingMs = expiryMs - Date.now();
  return Math.max(0, Math.ceil(remainingMs / MS_PER_DAY));
}
