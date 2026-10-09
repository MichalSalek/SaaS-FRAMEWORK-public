import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { EVENT_COMMANDS_AND_QUERIES_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import type { CurrentUser } from '@kernel/models/user/user.types';

/**
 * ADRR Model A — Account-state security gate (§13.1).
 *
 * DECISION (nie usuwaj tego komentarza):
 * SECURITY BOUNDARY — allowlist-by-state, NIE upraszczać do "blokuj gdy
 * !is_active". `getCurrentUser_IO` CELOWO populuje soft-deleted userów (currentUser
 * musi istnieć, by reactivate/gdpr-erase działały post-login), więc bez tej bramki
 * konto nieaktywne miałoby PEŁNY dostęp do app. Bramka po rozwiązaniu currentUser +
 * przejściu RBAC ogranicza nieaktywne konto do akcji dozwolonych dla jego stanu.
 *
 * Maszyna stanów (§13.1) — rozróżniana WYŁĄCZNIE przez is_active + deleted_at +
 * recovery_available (disabled_at NIE jest tu używane — to osobny marker admin-ban
 * na poziomie danych, ale klasyfikacja stanu opiera się na deleted_at):
 *   ACTIVE       is_active=true                                  → WSZYSTKO (pass)
 *   RECOVERABLE  is_active=false, deleted_at set, recovery=true  → get-current, reactivate, gdpr, logout
 *   EXPIRED      is_active=false, deleted_at set, recovery=false → get-current, gdpr, logout
 *   ADMIN-BAN    is_active=false, deleted_at=null                → get-current, logout
 *
 * Różnice (krytyczne — NIE zlewać w jeden flat allowlist):
 *   - reactivate: TYLKO RECOVERABLE (EXPIRED minęło okno; ADMIN-BAN nie może self-recover)
 *     UWAGA hybryda soft-delete→admin-ban (deleted_at set + recovery=true + disabled_at
 *     set): klasyfikowana tu jako RECOVERABLE (allowlist przepuszcza reactivate), ale
 *     egzekucję blokuje sama operacja — reactivateAccount_IO CAS WHERE disabled_at:null
 *     → ACCOUNT_NOT_RECOVERABLE. Ban NIE jest zdejmowalny przez recovery (DECISION przy
 *     guardzie w user-soft-delete.operations.ts). To celowy podział: guard klasyfikuje
 *     stan po deleted_at, twardą bramkę bana trzyma operacja.
 *   - self-gdpr (Art. 17): RECOVERABLE + EXPIRED, ale NIE ADMIN-BAN (ban = brak self-akcji)
 *   - get-current + logout: zawsze (potrzebne by frontend rozpoznał stan i wylogował)
 *
 * Login (Better Auth credentials) + logout/sign-out idą out-of-band przez
 * /api/auth/[...all] i NIE przechodzą przez HTTPRequestHandlerMiddleware — nigdy
 * nie trafią do tej bramki. USER_LOGOUT trzymany w allowlistach jako jawna
 * deklaracja intencji (defense-in-depth), nie jako realna ścieżka egzekucji.
 */

// Always permitted while inactive: read own state + log out (frontend routes the
// user by the state DTO it gets back, then signs them out).
const ALWAYS_ALLOWED_WHILE_INACTIVE: ReadonlySet<EVENT_COMMANDS_AND_QUERIES_TYPE> =
  new Set([
    APP_EVENTS.QUERIES.SESSION.SESSION_GET_CURRENT,
    APP_EVENTS.COMMANDS.USER.USER_LOGOUT,
  ]);

// DECISION (nie usuwaj tego komentarza):
// IMPERSONATION-EXIT (finding admin-impersonation-2 part b + impersonation-l2-1).
// SWITCH_BACK_BECOME_USER + REFRESH_IMPERSONATION muszą być dopuszczone dla KAŻDEGO
// nieaktywnego stanu, w który admin może wejść przez become-user — nie tylko ADMIN-BAN.
// `getUser_IO` (target lookup w adminBecomeUser_IO) NIE filtruje po is_active/deleted_at,
// więc admin może zaimpersonować RECOVERABLE (deleted_at set, recovery=true) oraz
// EXPIRED (deleted_at set, recovery=false) targety tak samo jak ADMIN-BAN. Po wejściu
// `currentUser` populuje się stanem nieaktywnego targetu i ta bramka (middleware step 5b,
// PRZED logiką biznesową) blokowałaby switch-back/refresh z 403 USER_DISABLED → admin
// uwięziony w sesji nieaktywnego targetu, jedyne wyjście to re-login out-of-band.
// Switch-back/refresh PRZYWRACAJĄ sesję ADMINA (nie targetu) i są pozytywnie zbindowane
// w admin-impersonation.operations.ts (currentUser.id===backup.impersonated_user_id ORAZ
// session.token===backup.impersonated_session_token, oba z DB), więc dopuszczenie ich dla
// nieaktywnego-target stanu jest bezpieczne — nie daje nieaktywnemu userowi żadnej akcji,
// tylko adminowi wyjście z impersonacji. Identyczna logika-bezpieczeństwa jak dla ADMIN-BAN,
// stąd wspólna stała spread'owana do WSZYSTKICH trzech nieaktywnych allowlist.
const IMPERSONATION_EXIT: ReadonlyArray<EVENT_COMMANDS_AND_QUERIES_TYPE> = [
  APP_EVENTS.COMMANDS.ADMIN.SWITCH_BACK_BECOME_USER,
  APP_EVENTS.COMMANDS.ADMIN.REFRESH_IMPERSONATION,
];

const RECOVERABLE_ALLOWLIST: ReadonlySet<EVENT_COMMANDS_AND_QUERIES_TYPE> =
  new Set([
    ...ALWAYS_ALLOWED_WHILE_INACTIVE,
    ...IMPERSONATION_EXIT,
    APP_EVENTS.COMMANDS.USER.USER_REACTIVATE_ACCOUNT,
    APP_EVENTS.COMMANDS.USER.USER_GDPR_ERASE,
  ]);

// DECISION (nie usuwaj tego komentarza):
// EXPIRED = legacy/defensive fail-safe. Po migracji recovery 30d→90d (FAZA C)
// MOVE (moveExpiredUserToArchive_IO) hard-deletuje row po 90d zamiast
// flipować recovery_available do false — więc żadna ścieżka już nie produkuje
// stanu EXPIRED (is_active=false, deleted_at set, recovery_available=false).
// Allowlist zachowany jako fail-safe (gdyby kiedyś istniał reżim flip-zamiast-
// MOVE), NIE usuwać.
const EXPIRED_ALLOWLIST: ReadonlySet<EVENT_COMMANDS_AND_QUERIES_TYPE> = new Set(
  [
    ...ALWAYS_ALLOWED_WHILE_INACTIVE,
    ...IMPERSONATION_EXIT,
    APP_EVENTS.COMMANDS.USER.USER_GDPR_ERASE,
  ]
);

// DECISION (nie usuwaj tego komentarza):
// ADMIN-BAN obejmuje TAKŻE self-disable (USER_DISABLE_SELF). disableSelfUser_IO
// ustawia is_active=false + disabled_at, ale NIE deleted_at — więc trafia tu
// (deleted_at===null). Świadomie NIE rozróżniamy self-disable od admin-ban:
//   - oba są nierozróżnialne na poziomie danych (disabled_at set, deleted_at null);
//     rozróżnienie wymagałoby migracji Prisma (osobny marker) — nieproporcjonalne.
//   - self-disable to CELOWO "trwałe wyłączenie wymagające kontaktu z adminem"
//     (decyzja produktowa 2026-05-30, QA finding ul-1), NIE tymczasowa pauza.
//     Brak USER_ENABLE_SELF jest zamierzony — reaktywacja idzie przez admina.
// OGRANICZENIE: self-disabled user nie ma self-service
// GDPR-erasure/export z tego stanu. Żądanie z tego stanu obsługuje admin/support.
// Jeśli to się zmieni → opcja B z _REVIEWS (marker self-vs-admin + SELF_DISABLED_ALLOWLIST).
// IMPERSONATION-EXIT (SWITCH_BACK_BECOME_USER + REFRESH_IMPERSONATION) spread'owane
// poniżej — rationale w komentarzu przy stałej IMPERSONATION_EXIT.
const ADMIN_BAN_ALLOWLIST: ReadonlySet<EVENT_COMMANDS_AND_QUERIES_TYPE> =
  new Set([...ALWAYS_ALLOWED_WHILE_INACTIVE, ...IMPERSONATION_EXIT]);

/**
 * Returns true when the resolved (authenticated) account is permitted to invoke
 * `eventName` given its lifecycle state. ACTIVE accounts always pass; inactive
 * accounts pass ONLY events on their state-specific allowlist.
 *
 * Pure + side-effect free — the caller (request.middleware) owns the HTTP response
 * on denial. Call ONLY after a user is resolved (anonymous/public requests have no
 * account state and must not be gated here).
 */
export const isAccountStateActionAllowed = ({
  currentUser,
  eventName,
}: {
  currentUser: CurrentUser;
  eventName: EVENT_COMMANDS_AND_QUERIES_TYPE;
}): boolean => {
  // ACTIVE — full access preserved.
  if (currentUser.is_active) {
    return true;
  }

  // Inactive: classify by deleted_at (self-delete marker) + recovery_available.
  if (currentUser.deleted_at !== null) {
    return currentUser.recovery_available
      ? RECOVERABLE_ALLOWLIST.has(eventName) // RECOVERABLE
      : EXPIRED_ALLOWLIST.has(eventName); // EXPIRED
  }

  // deleted_at === null while inactive ⇒ ADMIN-BAN (no self-delete in play).
  return ADMIN_BAN_ALLOWLIST.has(eventName);
};
