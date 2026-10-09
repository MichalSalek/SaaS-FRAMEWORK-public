import type { EVENT_INFO_TYPE } from '../commands-and-queries/cqrs.types';
import { API_VER } from '../http/http.config';
import type { ROUTES_FRONT_PATH } from './routing.types';

export const ROUTES_FRONT_STATIC = Object.freeze({
  HOME: '/',
  FOR_STYLISTS: '/for-stylists',
  FOR_CLIENTS: '/for-clients',
  FOR_STUDIOS: '/for-studios',
  PRICING: '/pricing',
  COMPARE: '/compare',
  ABOUT: '/about',
  CONTACT: '/contact',
  SITE_MAP: '/site-map',
  HELP_CENTER: '/help-center',
  TERMS: '/terms',
  PRIVACY: '/privacy',
  COOKIES: '/cookies',
  CONTENT_MODERATION: '/content-moderation',

  USER_LOG: '/user/login',

  CONNECTION_CHECK: '/connection-check',
  STATUS: '/status',
  MAINTENANCE: '/maintenance',
  STYLIST_PROFILE: '/stylist/[identifier]',
  GET_APP: '/get-app',
  WELCOME: '/welcome',

  EMAIL_UNSUBSCRIBE: '/email/unsubscribe',

  BLOG: '/blog',
  BLOG_POST: '/blog/[slug]',
  BLOG_CATEGORY: '/blog/category/[category]',
} as const);

export const ROUTES_FRONT_APP = Object.freeze({
  APP: '/app',

  /**
   * Web-home strefy `/app` — ekran startowy dla zalogowanego na DESKTOPIE.
   * Produkt jest mobile-only, więc laptop dostaje baner „weź to na telefon"
   * (ten sam hero co `/get-app`) plus skróty do konta, zamiast być wrzuconym
   * prosto w formularz ustawień. Kategoria dostępu: account-route
   * (`route-access.policy`), więc NIE jest bounce'owany na `/get-app`.
   */
  APP_HOME: '/app/home',

  ADMIN: '/app/admin',
  ADMIN_USERS: '/app/admin/users',
  ADMIN_LOGS: '/app/admin/logs',
  ADMIN_NOTES: '/app/admin/notes',
  ADMIN_POLICIES: '/app/admin/policies',
  ADMIN_PERMISSIONS: '/app/admin/permissions',
  ADMIN_COLORS_TRAITS: '/app/admin/colors-traits',
  ADMIN_FEATURE_FLAGS: '/app/admin/feature-flags',
  ADMIN_HEALTH: '/app/admin/health',
  ADMIN_AUDIT: '/app/admin/audit',
  ADMIN_ANNOUNCEMENTS: '/app/admin/announcements',
  ADMIN_REPORTS: '/app/admin/reports',
  ADMIN_CONFIG: '/app/admin/config',
  ADMIN_EMAIL_SCHEDULE: '/app/admin/email-schedule',
  ADMIN_EMAIL_PREVIEW: '/app/admin/email-preview',
  ADMIN_AI_CRAWLERS: '/app/admin/ai-crawlers',
  ADMIN_MODERATION: '/app/admin/moderation',

  USER_DEL_SELF: '/app/user/delete-self',
  USER_ACCOUNT: '/app/user/account',
  USER_ACCOUNT_PAY: '/app/user/account/pay',
  /** One section of the account screen opened as its own page (S126). */
  USER_ACCOUNT_SECTION: '/app/user/account/[section]',
  USER_ACTIVITY_LOG: '/app/user/activity',
  USER_ACTIVATE_CLIENT: '/app/user/activate-client',
  USER_ACTIVATE_STYLIST: '/app/user/activate-stylist',
  USER_RECOVER: '/app/user/recover',

  GALLERY_UPLOAD_ASSET: '/app/gallery/upload-asset',
  GALLERY: '/app/gallery',

  FAVORITES: '/app/favorites',
  STYLISTS: '/app/stylists',

  // Komunikator stylistka<->klientka: lista rozmów + wątek per para.
  MESSAGES: '/app/messages',
  MESSAGES_THREAD: '/app/messages/[pairId]',
  SHARED: '/app/shared',
  /**
   * The stylist's own clients: the list, waiting connection requests and what
   * needs her attention (owner 2026-10-09). Until then the list lived under
   * the QR code on `PAIRING`, a screen she turns towards a client.
   */
  CLIENTS: '/app/clients',
  CLIENT_CARD: '/app/clients/[id]',
  CLIENT_PROFILE: '/app/client-profile',
  PAIRING: '/app/pairing',

  /**
   * Zarządzanie PUBLICZNYM profilem stylistki od wewnątrz aplikacji: podgląd
   * tego, co widzi klientka, edycja wizytówki i wybór przypiętych zdjęć.
   * Osobna trasa od `/stylist/[identifier]` (ta jest publiczna, w PublicLayout
   * i bez dolnej belki — wejście na nią z apki zamykało użytkownika bez drogi
   * powrotnej; DECISION w appDrawerSections).
   */
  STYLIST_PROFILE_MANAGE: '/app/profile',
  ONBOARDING: '/app/onboarding',

  CHECKOUT_RETURN: '/app/checkout/return',

  SALON_STAFF: '/app/salon/staff',
  /**
   * Invitee screen (2026-09-25): the invited stylist sees her pending salon-team
   * invitations and accepts or declines each one. The invitation e-mail links
   * here. Separate from `SALON_STAFF` (that one is the OWNER's roster).
   */
  SALON_INVITATIONS: '/app/salon/invitations',
  SUPPORT: '/app/user/support',
  SUPPORT_THREAD: '/app/user/support/[threadId]',
  /** New-request form and the list of own threads as separate pages (S126). */
  SUPPORT_NEW: '/app/user/support/new',
  SUPPORT_THREADS: '/app/user/support/threads',
  ADMIN_SUPPORT: '/app/admin/support',
  ADMIN_SUPPORT_THREAD: '/app/admin/support/[threadId]',
  EXPLORE: '/app/explore',
  CLIENT_SESSIONS: '/app/sessions',
  CLIENT_SESSION_DETAIL: '/app/sessions/[sessionId]',
  SESSION_DETAIL: '/app/inbox/session/[sessionId]',
  PHOTO_DETAIL: '/app/photo/[id]',
  STYLIST_GALLERY: '/app/gallery/stylist/[id]',
  STYLE_DETAIL: '/app/style/[id]',
} as const);

export const ROUTES_FRONT = Object.freeze({
  ...ROUTES_FRONT_STATIC,
  ...ROUTES_FRONT_APP,
} as const);
export const ROUTES_FRONT_VALUES = Object.values(ROUTES_FRONT);

export const ROUTES_API = Object.freeze({
  ADMIN_CHECK_ACCESS_HEALTH: `${API_VER}admin/check-access`,
  ADMIN_CHECK_ACCESS: `${API_VER}admin/check-access/url`,
  SWITCH_BACKEND_DEBUG_MODE: `${API_VER}admin/debug-mode`,
  BECOME_USER: `${API_VER}admin/become-user`,
  SWITCH_BACK_BECOME_USER: `${API_VER}admin/switch-back-become-user`,
  REFRESH_IMPERSONATION: `${API_VER}admin/refresh-impersonation`,
  USER_DELETE_ANY: `${API_VER}admin/user/delete/any`,
  // ADMIN_PURGE_DELETED_USER — Art.17 hard-purge DeletedUser archive (POST, MASTER_ADMIN)
  ADMIN_PURGE_DELETED_USER: `${API_VER}admin/deleted-user/purge`,
  USER_DISABLE_ANY: `${API_VER}admin/user/disable/any`,
  USER_ENABLE_ANY: `${API_VER}admin/user/enable/any`,
  ADMIN_GET_PERMISSIONS: `${API_VER}admin/permissions`,
  ADMIN_UPDATE_PERMISSIONS: `${API_VER}admin/permissions/update`,
  GET_NOTES: `${API_VER}admin/get-notes`,
  SAVE_NOTE: `${API_VER}admin/save-note`,
  SET_MAIN_NOTE: `${API_VER}admin/set-main-note`,
  ADMIN_GET_POLICIES: `${API_VER}admin/get-policies`,
  ADMIN_SAVE_POLICY: `${API_VER}admin/save-policy`,
  ADMIN_DELETE_POLICY: `${API_VER}admin/delete-policy`,
  ADMIN_SET_MAIN_POLICY: `${API_VER}admin/set-main-policy`,
  GET_LOGS: `${API_VER}admin/get-logs`,
  SEND_LOG: `${API_VER}admin/send-log`,
  ADMIN_CHANGE_PRICING_PLAN: `${API_VER}admin/user/change-pricing-plan`,
  ADMIN_GET_USERS_PAGINATED: `${API_VER}admin/users`,
  ADMIN_CREATE_COLOR: `${API_VER}admin/create-color`,
  ADMIN_UPDATE_COLOR: `${API_VER}admin/update-color`,
  ADMIN_DELETE_COLOR: `${API_VER}admin/delete-color`,
  ADMIN_CREATE_TRAIT: `${API_VER}admin/create-trait`,
  ADMIN_UPDATE_TRAIT: `${API_VER}admin/update-trait`,
  ADMIN_DELETE_TRAIT: `${API_VER}admin/delete-trait`,
  ADMIN_GET_FEATURE_FLAGS: `${API_VER}admin/feature-flags`,
  ADMIN_TOGGLE_FEATURE_FLAG: `${API_VER}admin/feature-flags/toggle`,
  ADMIN_GET_METRICS: `${API_VER}admin/metrics`,
  ADMIN_GET_EMAIL_PREVIEW: `${API_VER}admin/mailing/preview`,
  ADMIN_GET_EMAIL_PIPELINE: `${API_VER}admin/mailing/pipeline`,
  ADMIN_GET_ATTENTION_COUNTS: `${API_VER}admin/attention-counts`,
  ADMIN_HEALTH: `${API_VER}admin/health`,
  ADMIN_GET_AUDIT_TRAIL: `${API_VER}admin/audit-trail`,
  ADMIN_GET_LOG_GROUPS: `${API_VER}admin/log-groups`,
  ADMIN_GET_LOG_DETAILS: `${API_VER}admin/log-details`,
  ADMIN_SET_LOG_ISSUE_STATUS: `${API_VER}admin/log-issue-status`,
  ADMIN_AI_CRAWLER_STATS: `${API_VER}admin/ai-crawler-stats`,
  ADMIN_AI_CRAWLER_LIST: `${API_VER}admin/ai-crawler-list`,
  ADMIN_BULK_DISABLE: `${API_VER}admin/users/bulk-disable`,
  ADMIN_BULK_ENABLE: `${API_VER}admin/users/bulk-enable`,
  ADMIN_BULK_CHANGE_PLAN: `${API_VER}admin/users/bulk-change-plan`,
  ADMIN_BULK_LOGOUT: `${API_VER}admin/users/bulk-logout`,
  ADMIN_GET_ANNOUNCEMENTS: `${API_VER}admin/announcements`,
  ADMIN_CREATE_ANNOUNCEMENT: `${API_VER}admin/announcements/create`,
  ADMIN_UPDATE_ANNOUNCEMENT: `${API_VER}admin/announcements/update`,
  ADMIN_DELETE_ANNOUNCEMENT: `${API_VER}admin/announcements/delete`,
  ADMIN_GET_USER_TIMELINE: `${API_VER}admin/user-timeline`,
  ADMIN_GET_REPORTS: `${API_VER}admin/reports`,
  ADMIN_GET_CONFIGS: `${API_VER}admin/config`,
  ADMIN_UPDATE_CONFIG: `${API_VER}admin/config/update`,
  ADMIN_RESOLVE_REPORT: `${API_VER}admin/moderation/resolve-report`,
  ADMIN_APPLY_STRIKE: `${API_VER}admin/moderation/apply-strike`,
  ADMIN_GET_CONTENT_REPORTS: `${API_VER}admin/moderation/reports`,
  GET_FEATURE_FLAGS_PUBLIC: `${API_VER}feature-flags`,
  GET_RUNTIME_CONFIG_PUBLIC: `${API_VER}runtime-config`,
  ANNOUNCEMENTS_GET_ACTIVE: `${API_VER}announcements/active`,

  // DECISION (nie usuwaj tego komentarza):
  // F2 dedup: routes renamed to match CQRS event names:
  //   USER_DELETE_SELF → USER_REQUEST_DELETE (handler uses USER_REQUEST_DELETE event)
  //   USER_CHANGE_EMAIL → USER_REQUEST_EMAIL_CHANGE (handler uses USER_REQUEST_EMAIL_CHANGE event)
  // D3 (run 24): USER_CONFIRM_* routes renamed to match new CONFIRMATIONS event names:
  //   USER_CONFIRM_DELETE → USER_DELETE_CONFIRM
  //   USER_CONFIRM_EMAIL_CHANGE → USER_EMAIL_CHANGE_CONFIRM
  // URL strings unchanged for API stability — only ROUTES_API KEY changed.
  USER_REQUEST_DELETE: `${API_VER}user/delete/self`,
  USER_DELETE_CONFIRM: `${API_VER}user/delete/confirm`,
  USER_DISABLE_SELF: `${API_VER}user/disable/self`,
  USER_CHANGE_NAME: `${API_VER}user/change-name`,
  USER_REQUEST_EMAIL_CHANGE: `${API_VER}user/change-email`,
  USER_ONBOARD_AS_STYLIST: `${API_VER}user/onboard-stylist`,
  USER_ONBOARD_AS_CLIENT: `${API_VER}user/onboard-client`,
  USER_GET_ACCOUNT_STATE: `${API_VER}user/account-state`,
  USER_GET_USAGE_STATS: `${API_VER}user/usage-stats`,
  USER_SWITCH_ROLE: `${API_VER}user/switch-role`,
  USER_CHECK_RECOVERY: `${API_VER}user/check-recovery`,
  USER_RESTORE_ACCOUNT: `${API_VER}user/restore-account`,
  // ADRR Model A: reactivate soft-deleted account (post-login) + GDPR erasure.
  USER_REACTIVATE_ACCOUNT: `${API_VER}user/reactivate`,
  USER_GDPR_ERASE: `${API_VER}user/gdpr-erase`,
  USER_EXPORT_DATA: `${API_VER}user/export-data`,
  USER_UPDATE_NOTIFICATION_PREFERENCES: `${API_VER}user/update-notification-preferences`,
  USER_EMAIL_CHANGE_CONFIRM: `${API_VER}user/confirm-email-change`,

  EVENT_LOG_GET_ALL: `${API_VER}event-log/get-all`,

  SESSION_DELETE_ALL: `${API_VER}session/delete/all`,
  SESSION_DELETE_EXACTLY: `${API_VER}session/delete/exactly`,
  SESSION_GET_ALL: `${API_VER}session/get-all`,
  SESSION_GET_CURRENT: `${API_VER}session/get-current`,

  // Dev only
  DEV_LOGIN: '/api/auth/dev-login',

  // Post-login token bridge (variant C). Public pre-auth: redeems the one-time
  // ?authCode minted by the auth after-hook for the session bearer token (returned
  // in the `authorization` response header). Lives under /api/auth/ (NOT /api/v1/)
  // alongside Better Auth + dev-login → inherits the strict rate-limit prefix.
  AUTH_EXCHANGE_CODE: '/api/auth/exchange-code',

  ACCOUNT_DISPLAY_NAME_CHANGE: `${API_VER}account/display-name-change`,
  // DECISION (nie usuwaj tego komentarza):
  // D5 (run 25 TRD): UPDATE_STYLIST_PROFILE replaces 3 prior routes (account/set-location,
  // account/set-vanity-url, stylist/update-social-links) with single atomic endpoint.
  // All 3 mutations now happen in a single $transaction — frontend dirty Save = 1 round-trip.
  UPDATE_STYLIST_PROFILE: `${API_VER}account/update-stylist-profile`,
  ACCOUNT_GET_STYLISTS_WITH_LOCATION: `${API_VER}account/get-stylists-with-location`,
  ACCOUNT_GET_PUBLIC_PROFILE: `${API_VER}public/get-stylist-profile`,
  ACCOUNT_STRIPE_PORTAL: `${API_VER}stripe/portal`,
  // SPE: dispatcher wyboru planu (Free | embedded Payment Element | hosted fallback) —
  // jedyny punkt wejścia płatności (legacy account/start-trial usunięty 2026-07-09).
  ACCOUNT_CHECKOUT_SESSION: `${API_VER}account/checkout-session`,
  // SPE: szybka zmiana planu paid->paid (subscription.update z proracją, SCA inline).
  ACCOUNT_PLAN_CHANGE: `${API_VER}account/plan-change`,
  // Faktura VAT: zapis danych firmowych kupującego na Stripe Customer przed confirm().
  ACCOUNT_VAT_INVOICE_DETAILS: `${API_VER}account/vat-invoice-details`,
  // Zdjęcie profilowe stylistki: ustawienie i wyczyszczenie na jednej trasie
  // (payload `avatar_url: null` = powrót do fallbacku OAuth/inicjałów).
  ACCOUNT_SET_AVATAR: `${API_VER}account/set-avatar`,
  ACCOUNT_INCREMENT_VIEW: `${API_VER}account/increment-view`,
  ACCOUNT_GET_DASHBOARD_FEED: `${API_VER}account/get-dashboard-feed`,
  ACCOUNT_SET_DASHBOARD_NOTE: `${API_VER}account/set-dashboard-note`,
  ACCOUNT_DISMISS_GALLERY_STRENGTH: `${API_VER}account/dismiss-gallery-strength`,
  ACCOUNT_GET_DASHBOARD_NOTE: `${API_VER}account/get-dashboard-note`,

  CREATE_GALLERY_RECORD: `${API_VER}gallery/create-gallery-record`,
  GET_GALLERY_RECORDS: `${API_VER}gallery/get-gallery-records`,
  DELETE_ASSET_FROM_VENDOR: `${API_VER}gallery/delete-asset-from-vendor`,
  UPDATE_GALLERY_RECORD: `${API_VER}gallery/update-record`,
  DELETE_GALLERY_RECORD: `${API_VER}gallery/delete-record`,
  GET_GALLERY_RECORD_BY_ID: `${API_VER}gallery/get-record-by-id`,
  PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT: `${API_VER}public/get-gallery-by-account`,
  GALLERY_GET_FOR_PAIRED_CLIENT: `${API_VER}gallery/get-for-paired-client`,
  PUBLIC_GET_SITEMAP_PROFILES: `${API_VER}public/sitemap-profiles`,
  GALLERY_PIN_RECORD: `${API_VER}gallery/pin-record`,
  GALLERY_UNPIN_RECORD: `${API_VER}gallery/unpin-record`,
  GET_COLORS: `${API_VER}gallery/colors`,
  GET_TRAITS: `${API_VER}gallery/traits`,
  // Key === CQRS event / DTO op / http-method key (EXPLORE_GALLERY_RECORDS) — pure
  // equality join; URL path unchanged for API stability. Alias to GALLERY_EXPLORE dropped.
  EXPLORE_GALLERY_RECORDS: `${API_VER}gallery/explore`,
  REPORT_GALLERY_RECORD: `${API_VER}gallery/report`,

  BOOKMARK_STYLIST: `${API_VER}bookmark/bookmark-stylist`,
  UNBOOKMARK_STYLIST: `${API_VER}bookmark/unbookmark-stylist`,
  GET_BOOKMARKED_STYLISTS: `${API_VER}bookmark/get-bookmarked`,
  FAVORITE_ADD_RECORD: `${API_VER}favorite/add-record`,
  FAVORITE_REMOVE_RECORD: `${API_VER}favorite/remove-record`,
  FAVORITE_GET_RECORDS: `${API_VER}favorite/get-records`,
  FAVORITE_UPDATE_RECORD_NOTE: `${API_VER}favorite/update-record-note`,
  FAVORITE_GET_GROUPED: `${API_VER}favorite/get-grouped`,

  PAIRING_SESSION_ISSUE: `${API_VER}pairing/issue-session`,
  PAIRING_SESSION_CLAIM: `${API_VER}pairing/claim-session`,
  PAIRING_SESSION_REVOKE: `${API_VER}pairing/revoke-session`,
  PAIRING_SESSION_REVOKE_ALL: `${API_VER}pairing/revoke-all-sessions`,
  PAIRING_ACCESS_REVOKE: `${API_VER}pairing/revoke-access`,
  PAIRING_GET_ACCESS_STATUS: `${API_VER}pairing/get-access-status`,
  PAIRING_GET_MY_PAIRS: `${API_VER}pairing/get-my-pairs`,
  PAIR_REQUEST_CREATE: `${API_VER}pairing/request-pair`,
  PAIR_REQUEST_RESPOND: `${API_VER}pairing/respond-request`,
  PAIR_REQUEST_CANCEL: `${API_VER}pairing/cancel-request`,
  PAIRING_GET_PENDING_REQUESTS: `${API_VER}pairing/pending-requests`,
  // DECISION (nie usuwaj tego komentarza):
  // SALON_STAFF jest WSPÓLNYM kluczem dla GET (SALON_STAFF_GET_ALL) + POST
  // (SALON_STAFF_INVITE) — oba CQRS events hostowane na tym samym path
  // (`salon/staff/index.ts` route handler switchuje na req.method). Alias frontend
  // → kernel: `main/src/application/http/http.endpoints.ts:30-31` mapuje
  // SALON_STAFF_INVITE + SALON_STAFF_GET_ALL → 'SALON_STAFF' route key. Osobne
  // klucze REMOVE / UPDATE_PERMISSIONS są wymagane bo dotykają inny path
  // (z param `[staffId]`). Asymetria celowa — nie dodawać SALON_STAFF_INVITE jako
  // duplicate key (collision na ENDPOINTS map by failowała w buildEndpoints).
  SALON_STAFF: `${API_VER}salon/staff`,
  SALON_STAFF_GET_BY_ID: `${API_VER}salon/staff/[staffId]`,
  SALON_STAFF_UPDATE_PERMISSIONS: `${API_VER}salon/staff/[staffId]/update`,
  SALON_STAFF_REMOVE: `${API_VER}salon/staff/[staffId]/delete`,
  // Invitee side (2026-09-25): the invited stylist's own pending invitations and
  // her answer. Scoped by the session user, never by a salon id in the path.
  SALON_STAFF_GET_MY_INVITATIONS: `${API_VER}salon/invitations`,
  SALON_STAFF_RESPOND_INVITATION: `${API_VER}salon/invitations/respond`,

  CLIENT_UPDATE_CONTACT: `${API_VER}client/update-contact`,
  CLIENT_GET_PROFILE: `${API_VER}client/profile`,
  CLIENT_GET_CONTACT_FOR_STYLIST: `${API_VER}client/contact/get-for-stylist`,
  CLIENT_GET_CRM_NOTE: `${API_VER}client/crm-note/get`,
  CLIENT_UPSERT_CRM_NOTE: `${API_VER}client/crm-note/upsert`,
  CLIENT_DELETE_CRM_NOTE: `${API_VER}client/crm-note/delete`,

  GET_CLIENT_VISITS: `${API_VER}visit/client-visits`,
  CREATE_MANUAL_VISIT: `${API_VER}visit/create-manual`,
  UPDATE_VISIT_NOTE: `${API_VER}visit/update-note`,
  ADD_VISIT_RESULT_PHOTO: `${API_VER}visit/result-photo/add`,
  REMOVE_VISIT_RESULT_PHOTO: `${API_VER}visit/result-photo/remove`,
  DELETE_MANUAL_VISIT: `${API_VER}visit/delete-manual`,

  PRICING_GET_PLANS: `${API_VER}pricing/get-plans`,

  NEWSLETTER_SUBSCRIBE: `${API_VER}public/newsletter-subscribe`,
  NEWSLETTER_CONFIRM: `${API_VER}public/newsletter-confirm/[token]`,
  NEWSLETTER_UNSUBSCRIBE: `${API_VER}public/newsletter-unsubscribe`,
  CONTACT_FORM_SUBMIT: `${API_VER}public/contact-form`,

  EMAIL_UNSUBSCRIBE: `${API_VER}email/unsubscribe`,
  EMAIL_UPDATE_PREFERENCES: `${API_VER}email/update-preferences`,
  EMAIL_GET_SCHEDULE: `${API_VER}email/get-schedule`,
  EMAIL_GET_HISTORY: `${API_VER}email/get-history`,

  GET_PUBLIC_STYLISTS_LIST: `${API_VER}stylist/get-public-list`,

  SESSION_CONTAINER_CREATE: `${API_VER}session-container/create`,
  SESSION_CONTAINER_ADD_PHOTO: `${API_VER}session-container/add-photo`,
  SESSION_CONTAINER_SHARE: `${API_VER}session-container/share`,
  SESSION_CONTAINER_CLOSE: `${API_VER}session-container/close`,
  SESSION_CONTAINER_GET_MY: `${API_VER}session-container/get-my`,
  SESSION_CONTAINER_GET_BY_ID: `${API_VER}session-container/get-by-id`,
  SESSION_CONTAINER_SET_NOTE: `${API_VER}session-container/set-note`,

  SUPPORT_CREATE_THREAD: `${API_VER}support/create-thread`,
  SUPPORT_ADD_MESSAGE: `${API_VER}support/add-message`,
  SUPPORT_GET_MY_THREADS: `${API_VER}support/my-threads`,
  SUPPORT_GET_THREAD_MESSAGES: `${API_VER}support/thread-messages`,
  SUPPORT_GET_UNREAD_COUNT: `${API_VER}support/unread-count`,
  SUPPORT_MARK_THREAD_READ: `${API_VER}support/mark-thread-read`,
  SUPPORT_ADMIN_GET_ALL_THREADS: `${API_VER}admin/support/threads`,
  SUPPORT_ADMIN_GET_THREAD_MESSAGES: `${API_VER}admin/support/thread-messages`,
  SUPPORT_ADMIN_REPLY: `${API_VER}admin/support/reply`,
  SUPPORT_CHANGE_STATUS: `${API_VER}admin/support/change-status`,

  // Komunikator stylistka<->klientka (jeden strumień per para).
  MESSAGING_SEND: `${API_VER}messaging/send`,
  MESSAGING_MARK_READ: `${API_VER}messaging/mark-read`,
  MESSAGING_GET_THREAD: `${API_VER}messaging/thread`,
  MESSAGING_GET_CONVERSATIONS: `${API_VER}messaging/conversations`,
  MESSAGING_HIDE_CONVERSATION: `${API_VER}messaging/hide`,
  MESSAGING_UNHIDE_CONVERSATION: `${API_VER}messaging/unhide`,

  // Internal S2S — no user context, secret-header auth, raw handler (excluded from CQRS/validation flow).
  INTERNAL_TRACK_CRAWLER: `${API_VER}internal/track-crawler`,

  // DECISION (nie usuwaj tego komentarza):
  // Public no-auth health endpoint pod /internal/ namespace mimo braku secret — zachowany dla
  // spójności z resztą internal/* endpoints (S2S monitoring pattern). Better Stack czyta z niego
  // pasywny, ostatnio zaobserwowany stan głównej puli; endpoint NIE wykonuje SQL, więc nie blokuje
  // Neon scale-to-zero. Sanitized: zero vendor names / error details / connection info.
  INTERNAL_HEALTH_PUBLIC: `${API_VER}internal/health-public`,

  // DECISION (nie usuwaj tego komentarza):
  // External clock for the maintenance sweeps (owner decision 2026-09-23). The
  // sweeps start only on accepted API traffic, and the mail windows
  // (onboarding 24-48 h, 2-day trial catch-up) passed unseen on days without
  // traffic. A Better Stack monitor calls this path; it wakes the database at
  // most once per 6 h and never in quiet hours, which is less than any
  // accepted API request already does, hence no secret (same as health-public).
  INTERNAL_SWEEP_TICK: `${API_VER}internal/sweep-tick`,
} as const);

export const CRITICAL_REDIRECTIONS_ON_EVENTS = Object.freeze({
  UNAUTHORIZED: ROUTES_FRONT.APP,
  ALREADY_LOGGED: ROUTES_FRONT.APP,
  // DECISION (nie usuwaj tego komentarza):
  // SESSION_EXPIRED jest reserved/not-yet-emitted przez backend (mirror DECISION
  // w common-errors.types.ts:15-20). Better Auth obsługuje wygaśnięcie sesji
  // bezpośrednio (401), a REALNE wygaśnięcie w app-layer emituje LOGIN_FIRST
  // (→ USER_LOG), nie SESSION_EXPIRED. Ten wpis (target HOME) jest LIVE w pipeline,
  // ale dziś NIGDY się nie odpala — zostaje jako gotowe okablowanie na przyszły
  // explicit session-expiry hook. Rozbieżność target (HOME vs USER_LOG dla
  // LOGIN_FIRST) jest świadoma i nie do "naprawy" dopóki backend nie emituje
  // SESSION_EXPIRED. Komentarz zamyka powracające pytanie review.
  SESSION_EXPIRED: ROUTES_FRONT.HOME,
  LOGIN_FIRST: ROUTES_FRONT.USER_LOG,
  PLATFORM_GATE: ROUTES_FRONT.GET_APP,
  // DECISION (nie usuwaj tego komentarza):
  // USER_DISABLED → USER_LOG = graceful eviction nieaktywnego konta (admin-ban /
  // self-disable / soft-deleted). Backend (account-state-guard) zwraca 403 z
  // event USER_DISABLED na KAŻDĄ niedozwoloną akcję dla nieaktywnego stanu (ten
  // 403 NIE jest 401, więc Better Auth/idle-guard go nie łapie). Bez tego wpisu
  // user z ważnym tokenem siedziałby w pół-zepsutym /app/* shellu, dostając 403
  // snackbary bez wyjścia. Wpięte przez event pipeline (interceptor → eventbus →
  // ten critical redirect), wzór jak LOGIN_FIRST/SESSION_EXPIRED. UNCONDITIONAL
  // (event-pipeline.config REDIRECT_UNCONDITIONAL) — RBAC banned usera nadal
  // przepuszcza trasy jego roli, więc conditional-permission-check pominąłby
  // redirect; + STATE_FULL_RESET czyści cache currentUser. Brak dedykowanego
  // ekranu "konto wyłączone" w ROUTES_FRONT → USER_LOG (login). Faktyczne
  // wyczyszczenie tokenu robi AuthContext settled-null guard, gdy backend
  // unieważni sesję (disableUser_IO kasuje wiersze sesji) — ten redirect to
  // FRONTEND UX eviction, nie security boundary (backend trzyma granicę).
  USER_DISABLED: ROUTES_FRONT.USER_LOG,
} as const);

export const REDIRECTIONS_ON_EVENTS: Partial<
  Record<EVENT_INFO_TYPE, ROUTES_FRONT_PATH>
> = Object.freeze({
  USER_LOGGED_IN: ROUTES_FRONT.APP,
  USER_DISABLED_SELF: ROUTES_FRONT.HOME,
  USER_LOGGED_OUT: ROUTES_FRONT.HOME,
  USER_DELETED_SELF: ROUTES_FRONT.HOME,
  USER_SWITCHED_BACK_TO_SELF: ROUTES_FRONT.ADMIN_USERS,
  USER_BECAME_SOMEONE_ELSE: ROUTES_FRONT.APP,
  DEV_LOGIN_SUCCESS: ROUTES_FRONT.APP,
} as const);
