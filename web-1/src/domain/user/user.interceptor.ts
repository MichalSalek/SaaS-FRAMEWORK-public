import type {
  CurrentUser,
  UserWithRelations,
} from '@kernel/models/user/user.types';

// DECISION (nie usuwaj tego komentarza):
// BUG-001 (FAZA C): EXPIRING/EXPIRED account_status transitions przeniesione do dziennego sweepa
// (sweepExpiringAndExpiredAccounts_IO, safeStep w email-lifecycle.orchestrator). Interceptor jest
// teraz PASS-THROUGH — eliminuje DB UPDATE na KAŻDYM authenticated requeście (write-on-read
// anti-pattern), który był napędzany stale account_expiration_date (admin-estymata now+30d, NIE
// Stripe — stąd log "Bug detected" przy PAID-ale-wygasłym). account_status liczony jest teraz z
// subscription_status + current_period_end (Stripe SSOT, BUG-002), poza ścieżką request.
//
// Sygnatura zachowana — woła ją request.middleware.ts. Zwraca usera bez zmian (null-safe).
export const currentUserEntityInterceptor = async (
  user: UserWithRelations | CurrentUser | null | undefined
): Promise<UserWithRelations | CurrentUser | null | undefined> => {
  return user ?? null;
};
