/**
 * Role Permissions — SSOT for default role permissions (API events)
 *
 * This file is the SSOT for which APP_EVENTS each system role can dispatch.
 * Lifted (Wave 1B C2 fix) out of the backend `permissions.config.ts` into kernel
 * so that ALL consumers (backend seed/cache, smoke tests, audit scripts, context
 * snapshot generator) read from a single source of truth.
 *
 * Layering:
 * - BASE_PERMISSIONS: available to everyone (incl. NOT_LOGGED_IN role)
 * - LOGGED_USER_PERMISSIONS: all authenticated roles (extends BASE)
 * - STYLIST_SPECIFIC_PERMISSIONS: stylist + admin only
 * - CLIENT_SPECIFIC_PERMISSIONS: client + admin only
 * - Anything else: MASTER_ADMIN-only (via wildcard `getAllEvents()`)
 *
 * Consumers:
 * - web-1 backend: permissions.seed.ts, permissions.cache.ts, permissions.config.ts (re-export)
 * - tests/smoke/_rbac-matrix.ts: import as kernel SSOT
 * - tests/audit/permissions.sh: parses this file (via PERMISSIONS_BACKEND_CONFIG)
 * - tests/utils/generate-context-snapshot.ts: SSOT reference for docs
 *
 * SYSTEM_ROLES_META and SELF_ONLY_EVENTS remain in web-1 (backend-only consumers).
 */

import { APP_EVENTS } from '../domain/events/app-events.const';

// Permission sets (DRY - Don't Repeat Yourself)
export const BASE_PERMISSIONS = [
  // DECISION (nie usuwaj tego komentarza):
  // SEND_LOG in BASE_PERMISSIONS is intentional — anonymous/pre-auth client errors
  // must be reportable (auth flow itself can fail). Defense-in-depth:
  //   1. STRICT rate-limit (5 req/s) via rateLimit.middleware.ts STRICT_ENDPOINTS
  //   2. Payload caps at operation boundary (admin-logs.operations.ts: 4KB message,
  //      8KB payload) — prevents DB bloat from over-sized payloads
  //   3. shouldLogMessage rate limiter (log-rate-limiter.ts) drops floods per namespace+message
  // Endpoint is INSERT-only, no PII read access. Lifting auth would lose pre-login error visibility.
  APP_EVENTS.COMMANDS.ADMIN.SEND_LOG,
  APP_EVENTS.QUERIES.ACCOUNT.ACCOUNT_GET_PUBLIC_PROFILE,
  APP_EVENTS.QUERIES.GALLERY.PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT,
  APP_EVENTS.QUERIES.GALLERY.PUBLIC_GET_SITEMAP_PROFILES,
  APP_EVENTS.COMMANDS.USER.DEV_LOGIN,
  APP_EVENTS.COMMANDS.USER.USER_CHECK_RECOVERY,
  APP_EVENTS.QUERIES.SESSION.SESSION_GET_CURRENT,
  APP_EVENTS.QUERIES.APPLICATION.ANNOUNCEMENTS_GET_ACTIVE,
  APP_EVENTS.COMMANDS.NEWSLETTER.NEWSLETTER_SUBSCRIBE,
  APP_EVENTS.COMMANDS.NEWSLETTER.NEWSLETTER_UNSUBSCRIBE,
  // Public account endpoints (no auth required)
  APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_INCREMENT_VIEW,
  // Public paginated list of stylists (Favorites/Explore "Stylistki" tab — no auth required)
  APP_EVENTS.QUERIES.PUBLIC.GET_PUBLIC_STYLISTS_LIST,
  // DECISION (nie usuwaj tego komentarza):
  // Public feature flags (BLOG_ENABLED, EXPLORE_ENABLED, …) gate PUBLIC-facing UI and
  // are read by PublicFooter on EVERY marketing/LP page. The public endpoint returns
  // key→enabled only (no admin metadata: no description/expiry), is already readable by
  // every logged-in CLIENT, and the flags gate publicly-visible UI — so the exposed state
  // is non-sensitive. Admin flag management stays MASTER_ADMIN-gated (ADMIN_GET_FEATURE_FLAGS
  // / ADMIN_TOGGLE_FEATURE_FLAG).
  // UWAGA: endpoint jest authCheck:false (feature-flags/index.ts) — to PRIMARY gate i NIE
  // wolno go zdjac. Z authCheck:true token soft-deleted usera 403-owalby na account-state gate
  // (5b) → eviction z /recover. Wpis w BASE_PERMISSIONS zostaje jako FE-constant + parytet
  // runtime-config, ale to authCheck:false, nie ten wpis, zamyka bug.
  APP_EVENTS.QUERIES.ADMIN.GET_FEATURE_FLAGS_PUBLIC,
  // DECISION (nie usuwaj tego komentarza):
  // Public runtime-config (maintenance banner) — mounted globally (PublicLayout + AppLayout)
  // incl. pre-login pages, fetched on every page. The endpoint exposes ONLY
  // { maintenanceMessage } (narrow allow-list, getPublicRuntimeConfig_IO) — no other runtime
  // knob leaks. Admin config management stays MASTER_ADMIN-gated (ADMIN_GET_CONFIGS /
  // ADMIN_UPDATE_CONFIG).
  // UWAGA: endpoint jest authCheck:false (runtime-config/index.ts) — PRIMARY gate, NIE
  // zdejmowac (authCheck:true → 403 USER_DISABLED na account-state gate dla soft-deleted →
  // eviction z /recover). Wpis w BASE_PERMISSIONS = FE-constant + defense-in-depth.
  APP_EVENTS.QUERIES.APPLICATION.GET_RUNTIME_CONFIG_PUBLIC,
  // DECISION (nie usuwaj tego komentarza):
  // CONFIRMATIONS events = GET-as-Command from emailed links. Wired into BASE_PERMISSIONS
  // (NOT_LOGGED_IN role) because user may be logged out when clicking. Token in query
  // string is the security boundary (HMAC-signed for unsubscribe, DB-backed for the rest).
  APP_EVENTS.CONFIRMATIONS.EMAIL_UNSUBSCRIBE,
  APP_EVENTS.CONFIRMATIONS.NEWSLETTER_CONFIRM,
  APP_EVENTS.CONFIRMATIONS.USER_EMAIL_CHANGE_CONFIRM,
  APP_EVENTS.CONFIRMATIONS.USER_DELETE_CONFIRM,
] as const;

export const LOGGED_USER_PERMISSIONS = [
  ...BASE_PERMISSIONS,
  // User management
  // DECISION (nie usuwaj tego komentarza):
  // USER_LOGOUT handled by Better Auth provider routes (out-of-band CQRS),
  // permission entry kept for FE constant reference.
  APP_EVENTS.COMMANDS.USER.USER_LOGOUT,
  APP_EVENTS.COMMANDS.USER.USER_CHANGE_NAME,
  APP_EVENTS.COMMANDS.USER.USER_REQUEST_EMAIL_CHANGE,
  APP_EVENTS.COMMANDS.USER.USER_DISABLE_SELF,
  APP_EVENTS.COMMANDS.USER.USER_REQUEST_DELETE,
  // Onboarding (user chooses role)
  APP_EVENTS.COMMANDS.USER.USER_ONBOARD_AS_STYLIST,
  APP_EVENTS.COMMANDS.USER.USER_ONBOARD_AS_CLIENT,
  // Account state & usage
  APP_EVENTS.QUERIES.USER.USER_GET_ACCOUNT_STATE,
  APP_EVENTS.QUERIES.USER.USER_GET_USAGE_STATS,
  APP_EVENTS.COMMANDS.USER.USER_SWITCH_ROLE,
  APP_EVENTS.COMMANDS.USER.USER_RESTORE_ACCOUNT,
  // ADRR Model A: self soft-delete reactivation + GDPR erasure (own account).
  // Soft-deleted user keeps their role → LOGGED_USER scope covers reactivate.
  APP_EVENTS.COMMANDS.USER.USER_REACTIVATE_ACCOUNT,
  APP_EVENTS.COMMANDS.USER.USER_GDPR_ERASE,
  APP_EVENTS.COMMANDS.USER.USER_EXPORT_DATA,
  // Session management
  APP_EVENTS.COMMANDS.SESSION.SESSION_DELETE_ALL,
  APP_EVENTS.COMMANDS.SESSION.SESSION_DELETE_EXACTLY,
  APP_EVENTS.QUERIES.SESSION.SESSION_GET_ALL,
  // Become-user switch-back & refresh (user may have any role during impersonation)
  APP_EVENTS.COMMANDS.ADMIN.SWITCH_BACK_BECOME_USER,
  APP_EVENTS.COMMANDS.ADMIN.REFRESH_IMPERSONATION,
  // DECISION (nie usuwaj tego komentarza):
  // Salon-team invitations on the INVITEE side sit in LOGGED_USER, not in
  // STYLIST_SPECIFIC with the owner's roster events. The answer is a personal
  // consent (be listed by name and photo in that salon's team), bound to the
  // user and not to the active role: RBAC reads role_id, which follows the
  // role switch, so a stylist browsing in client mode would get 403 on the
  // link from the invitation e-mail. No widening follows from this: both
  // operations filter on user_id = the session user, and only accounts with a
  // stylist profile can be invited at all (inviteStaffMember_IO), so a pure
  // client account always sees an empty list.
  APP_EVENTS.QUERIES.SALON_STAFF.SALON_STAFF_GET_MY_INVITATIONS,
  APP_EVENTS.COMMANDS.SALON_STAFF.SALON_STAFF_RESPOND_INVITATION,
  // Event log
  APP_EVENTS.QUERIES.EVENT_LOG.EVENT_LOG_GET_ALL,
  // Account queries
  APP_EVENTS.QUERIES.ACCOUNT.ACCOUNT_GET_STYLISTS_WITH_LOCATION,
  // Gallery queries
  APP_EVENTS.QUERIES.GALLERY.GET_GALLERY_RECORD_BY_ID,
  APP_EVENTS.QUERIES.GALLERY.EXPLORE_GALLERY_RECORDS,
  // Feature flags (public) moved to BASE_PERMISSIONS — anonymous LP visitors need it
  // (PublicFooter). Logged-in roles still inherit it via the ...BASE_PERMISSIONS spread.
  // Notification preferences
  APP_EVENTS.COMMANDS.USER.USER_UPDATE_NOTIFICATION_PREFERENCES,
  // FAVORITE_GET_GROUPED moved to CLIENT_SPECIFIC_PERMISSIONS (FAV-RBAC-GROUPED-1):
  // its handler is client-only (requireClientAccount), so leaving it here let a
  // stylist-only user past RBAC only to hit a 401 — out of step with the 7 sibling
  // favorite events that correctly deny at the RBAC layer (403). See CLIENT block.
  // Email queries (schedule is read-only config; history uses currentUser.id — safe for all,
  // CLIENT gets a harmless empty history). EMAIL_UPDATE_PREFERENCES moved to STYLIST_SPECIFIC
  // (pe-3 QA): email_preferences/marketing/trial_sequence are StylistAccount-only columns, so a
  // CLIENT calling it hit EMAIL_USER_NOT_FOUND (404). RBAC-deny (403) is the honest contract.
  APP_EVENTS.QUERIES.EMAIL.EMAIL_GET_SCHEDULE,
  APP_EVENTS.QUERIES.EMAIL.EMAIL_GET_HISTORY,
  // Content moderation — any logged-in user can report content
  APP_EVENTS.COMMANDS.GALLERY.REPORT_GALLERY_RECORD,
  // Dashboard note (both roles)
  APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_SET_DASHBOARD_NOTE,
  APP_EVENTS.QUERIES.ACCOUNT.ACCOUNT_GET_DASHBOARD_NOTE,
  // Support messaging — any logged-in user can create/view threads
  APP_EVENTS.COMMANDS.SUPPORT.SUPPORT_CREATE_THREAD,
  APP_EVENTS.COMMANDS.SUPPORT.SUPPORT_ADD_MESSAGE,
  APP_EVENTS.QUERIES.SUPPORT.SUPPORT_GET_MY_THREADS,
  APP_EVENTS.QUERIES.SUPPORT.SUPPORT_GET_THREAD_MESSAGES,
  APP_EVENTS.QUERIES.SUPPORT.SUPPORT_GET_UNREAD_COUNT,
  APP_EVENTS.COMMANDS.SUPPORT.SUPPORT_MARK_THREAD_READ,
  // Stylist<->client messaging — obie role (stylistka i klientka) piszą/czytają;
  // dostęp do KONKRETNEJ pary jest gejtowany w operacjach (caller musi być stroną
  // pary), tu tylko bramka „zalogowany może korzystać z komunikatora".
  APP_EVENTS.COMMANDS.MESSAGING.MESSAGING_SEND,
  APP_EVENTS.COMMANDS.MESSAGING.MESSAGING_MARK_READ,
  APP_EVENTS.COMMANDS.MESSAGING.MESSAGING_HIDE_CONVERSATION,
  APP_EVENTS.COMMANDS.MESSAGING.MESSAGING_UNHIDE_CONVERSATION,
  APP_EVENTS.QUERIES.MESSAGING.MESSAGING_GET_THREAD,
  APP_EVENTS.QUERIES.MESSAGING.MESSAGING_GET_CONVERSATIONS,
  // Gallery taxonomy dictionaries (read-only, global — zero user data). Moved from
  // STYLIST_SPECIFIC (2026-06-12): /app/explore (EXPLORE_GALLERY_RECORDS, already
  // LOGGED_USER) renders color/trait filters for CLIENTS too — stylist-gating these
  // dictionaries 403'd the explore screen for clients and the http interceptor
  // bounced them to /app. Masked until now because EXPLORE_ENABLED was always OFF.
  APP_EVENTS.QUERIES.GALLERY.GET_COLORS,
  APP_EVENTS.QUERIES.GALLERY.GET_TRAITS,
] as const;

export const STYLIST_SPECIFIC_PERMISSIONS = [
  // Account management
  APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_DISPLAY_NAME_CHANGE,
  APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_STRIPE_PORTAL,
  // SPE: wybór planu + zmiana planu (stylistka płaci za subskrypcję)
  APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_CHECKOUT_SESSION,
  APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_PLAN_CHANGE,
  // Faktura VAT: zapis danych firmowych kupującego przed confirm()
  APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_VAT_INVOICE_DETAILS,
  // D5 (run 25 TRD): consolidated atomic profile update (location + vanity + social)
  APP_EVENTS.COMMANDS.ACCOUNT.UPDATE_STYLIST_PROFILE,
  // Zdjęcie profilowe stylistki (ustaw / wyczyść) — wizytówka jest stylistowa,
  // więc uprawnienie stoi obok reszty zarządzania profilem, nie w LOGGED_USER.
  APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_SET_AVATAR,
  APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_DISMISS_GALLERY_STRENGTH,
  // Gallery management
  APP_EVENTS.COMMANDS.GALLERY.CREATE_GALLERY_RECORD,
  APP_EVENTS.COMMANDS.GALLERY.DELETE_GALLERY_RECORD,
  APP_EVENTS.COMMANDS.GALLERY.UPDATE_GALLERY_RECORD,
  APP_EVENTS.COMMANDS.GALLERY.GALLERY_PIN_RECORD,
  APP_EVENTS.COMMANDS.GALLERY.GALLERY_UNPIN_RECORD,
  APP_EVENTS.QUERIES.GALLERY.GET_GALLERY_RECORDS,
  // GET_COLORS / GET_TRAITS moved to LOGGED_USER (explore filters; 2026-06-12)
  APP_EVENTS.COMMANDS.GALLERY.DELETE_ASSET_FROM_VENDOR,
  // Pairing management (Stylist side)
  APP_EVENTS.COMMANDS.PAIRING.PAIRING_SESSION_ISSUE,
  APP_EVENTS.COMMANDS.PAIRING.PAIRING_SESSION_REVOKE,
  APP_EVENTS.COMMANDS.PAIRING.PAIRING_SESSION_REVOKE_ALL,
  APP_EVENTS.COMMANDS.PAIRING.PAIRING_ACCESS_REVOKE,
  APP_EVENTS.QUERIES.PAIRING.PAIRING_GET_MY_PAIRS,
  // Stały kod QR: odpowiedź na prośbę + lista próśb PENDING (stylist side)
  APP_EVENTS.COMMANDS.PAIRING.PAIR_REQUEST_RESPOND,
  APP_EVENTS.QUERIES.PAIRING.PAIRING_GET_PENDING_REQUESTS,
  // Client contact (Stylist can view paired client contact)
  APP_EVENTS.QUERIES.CLIENT.CLIENT_GET_CONTACT_FOR_STYLIST,
  APP_EVENTS.QUERIES.CLIENT.CLIENT_GET_CRM_NOTE,
  APP_EVENTS.COMMANDS.CLIENT.CLIENT_UPSERT_CRM_NOTE,
  APP_EVENTS.COMMANDS.CLIENT.CLIENT_DELETE_CRM_NOTE,
  APP_EVENTS.QUERIES.VISIT.GET_CLIENT_VISITS,
  APP_EVENTS.COMMANDS.VISIT.CREATE_MANUAL_VISIT,
  APP_EVENTS.COMMANDS.VISIT.UPDATE_VISIT_NOTE,
  APP_EVENTS.COMMANDS.VISIT.ADD_VISIT_RESULT_PHOTO,
  APP_EVENTS.COMMANDS.VISIT.REMOVE_VISIT_RESULT_PHOTO,
  APP_EVENTS.COMMANDS.VISIT.DELETE_MANUAL_VISIT,
  APP_EVENTS.COMMANDS.SALON_STAFF.SALON_STAFF_INVITE,
  APP_EVENTS.COMMANDS.SALON_STAFF.SALON_STAFF_REMOVE,
  APP_EVENTS.COMMANDS.SALON_STAFF.SALON_STAFF_UPDATE_PERMISSIONS,
  APP_EVENTS.QUERIES.SALON_STAFF.SALON_STAFF_GET_ALL,
  APP_EVENTS.QUERIES.SALON_STAFF.SALON_STAFF_GET_BY_ID,
  // Dashboard feed (includes gallery_strength_score, supersedes separate ACCOUNT_GET_GALLERY_STRENGTH)
  APP_EVENTS.QUERIES.ACCOUNT.ACCOUNT_GET_DASHBOARD_FEED,
  // Session container (Stylist side: read-only list/detail of shared sessions, set stylist_note, close)
  APP_EVENTS.COMMANDS.SESSION_CONTAINER.SESSION_CONTAINER_CLOSE,
  APP_EVENTS.COMMANDS.SESSION_CONTAINER.SESSION_CONTAINER_SET_NOTE,
  APP_EVENTS.QUERIES.SESSION_CONTAINER.SESSION_CONTAINER_GET_MY,
  APP_EVENTS.QUERIES.SESSION_CONTAINER.SESSION_CONTAINER_GET_BY_ID,
  // Email preferences — StylistAccount-only fields (email_preferences/marketing/trial_sequence).
  // Moved from LOGGED_USER (pe-3 QA): a CLIENT has no StylistAccount → previously 404; stylist-gated
  // now yields correct 403 for non-stylists. Read-only EMAIL_GET_SCHEDULE/HISTORY stay in LOGGED_USER.
  APP_EVENTS.COMMANDS.EMAIL.EMAIL_UPDATE_PREFERENCES,
] as const;

export const CLIENT_SPECIFIC_PERMISSIONS = [
  // Bookmark (Client-only — stylists cannot bookmark)
  APP_EVENTS.COMMANDS.FAVORITE.BOOKMARK_STYLIST,
  APP_EVENTS.COMMANDS.FAVORITE.UNBOOKMARK_STYLIST,
  APP_EVENTS.QUERIES.FAVORITE.GET_BOOKMARKED_STYLISTS,
  APP_EVENTS.COMMANDS.FAVORITE.FAVORITE_ADD_RECORD,
  APP_EVENTS.COMMANDS.FAVORITE.FAVORITE_REMOVE_RECORD,
  APP_EVENTS.QUERIES.FAVORITE.FAVORITE_GET_RECORDS,
  // FAV-RBAC-GROUPED-1: handler is client-only (requireClientAccount) like its
  // siblings — RBAC-deny here yields 403 for stylist-only users (was 401 when it
  // lived in LOGGED_USER_PERMISSIONS).
  APP_EVENTS.QUERIES.FAVORITE.FAVORITE_GET_GROUPED,
  APP_EVENTS.COMMANDS.FAVORITE.FAVORITE_UPDATE_RECORD_NOTE,
  // Gallery (Client — paired gallery access)
  APP_EVENTS.QUERIES.GALLERY.GALLERY_GET_FOR_PAIRED_CLIENT,
  // Pairing (Client side)
  APP_EVENTS.COMMANDS.PAIRING.PAIRING_SESSION_CLAIM,
  APP_EVENTS.COMMANDS.PAIRING.PAIRING_ACCESS_REVOKE,
  APP_EVENTS.QUERIES.PAIRING.PAIRING_GET_ACCESS_STATUS,
  APP_EVENTS.QUERIES.PAIRING.PAIRING_GET_MY_PAIRS,
  // Stały kod QR: prośba o połączenie z publicznego profilu (client side)
  APP_EVENTS.COMMANDS.PAIRING.PAIR_REQUEST_CREATE,
  // O1: klientka wycofuje własną prośbę PENDING
  APP_EVENTS.COMMANDS.PAIRING.PAIR_REQUEST_CANCEL,
  // Client profile
  APP_EVENTS.COMMANDS.CLIENT.CLIENT_UPDATE_CONTACT,
  APP_EVENTS.QUERIES.CLIENT.CLIENT_GET_PROFILE,
  // Session container (Client side: full CRUD on own sessions)
  APP_EVENTS.COMMANDS.SESSION_CONTAINER.SESSION_CONTAINER_CREATE,
  APP_EVENTS.COMMANDS.SESSION_CONTAINER.SESSION_CONTAINER_ADD_PHOTO,
  APP_EVENTS.COMMANDS.SESSION_CONTAINER.SESSION_CONTAINER_SHARE,
  APP_EVENTS.COMMANDS.SESSION_CONTAINER.SESSION_CONTAINER_CLOSE,
  APP_EVENTS.COMMANDS.SESSION_CONTAINER.SESSION_CONTAINER_SET_NOTE,
  APP_EVENTS.QUERIES.SESSION_CONTAINER.SESSION_CONTAINER_GET_MY,
  APP_EVENTS.QUERIES.SESSION_CONTAINER.SESSION_CONTAINER_GET_BY_ID,
] as const;
