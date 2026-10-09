/**
 * HTTP METHODS REFERENCE (SSOT)
 *
 * This file documents the correct HTTP method for each API endpoint.
 * Generated from: Comprehensive API Testing (2026-02-02)
 *
 * CONVENTION:
 * - GET: Read operations without complex payload (simple query params)
 * - POST: All other operations (create, update, delete, complex queries)
 *
 * NOTE: Some endpoints accept both GET and POST for flexibility.
 */

export const API_HTTP_METHODS = Object.freeze({
  // ============================================
  // SYSTEM / PUBLIC
  // ============================================
  INTERNAL_HEALTH_PUBLIC: 'GET',
  INTERNAL_SWEEP_TICK: 'GET',

  // ============================================
  // AUTH & SESSION
  // ============================================
  DEV_LOGIN: 'POST',
  SESSION_GET_CURRENT: 'GET',
  SESSION_GET_ALL: 'GET',
  SESSION_DELETE_ALL: 'POST',
  SESSION_DELETE_EXACTLY: 'POST',

  // ============================================
  // ADMIN
  // ============================================
  ADMIN_CHECK_ACCESS: 'POST',
  ADMIN_CHECK_ACCESS_HEALTH: 'GET',
  ADMIN_GET_PERMISSIONS: 'GET',
  ADMIN_UPDATE_PERMISSIONS: 'POST',
  SWITCH_BACKEND_DEBUG_MODE: 'POST',
  BECOME_USER: 'POST',
  SWITCH_BACK_BECOME_USER: 'POST',
  REFRESH_IMPERSONATION: 'POST',
  GET_NOTES: 'GET',
  SAVE_NOTE: 'POST',
  SET_MAIN_NOTE: 'POST',
  ADMIN_GET_POLICIES: 'GET',
  ADMIN_SAVE_POLICY: 'POST',
  ADMIN_DELETE_POLICY: 'POST',
  ADMIN_SET_MAIN_POLICY: 'POST',
  GET_LOGS: 'GET',
  SEND_LOG: 'POST',
  ADMIN_CHANGE_PRICING_PLAN: 'POST',
  ADMIN_GET_USERS_PAGINATED: 'GET',
  ADMIN_CREATE_COLOR: 'POST',
  ADMIN_UPDATE_COLOR: 'POST',
  ADMIN_DELETE_COLOR: 'POST',
  ADMIN_CREATE_TRAIT: 'POST',
  ADMIN_UPDATE_TRAIT: 'POST',
  ADMIN_DELETE_TRAIT: 'POST',
  ADMIN_GET_FEATURE_FLAGS: 'GET',
  ADMIN_TOGGLE_FEATURE_FLAG: 'POST',
  ADMIN_GET_METRICS: 'GET',
  ADMIN_GET_EMAIL_PREVIEW: 'GET',
  ADMIN_GET_EMAIL_PIPELINE: 'GET',
  ADMIN_GET_ATTENTION_COUNTS: 'GET',
  ADMIN_HEALTH: 'GET',
  ADMIN_GET_AUDIT_TRAIL: 'GET',
  ADMIN_GET_LOG_GROUPS: 'GET',
  ADMIN_GET_LOG_DETAILS: 'GET',
  ADMIN_SET_LOG_ISSUE_STATUS: 'POST',
  ADMIN_AI_CRAWLER_STATS: 'GET',
  ADMIN_AI_CRAWLER_LIST: 'GET',
  ADMIN_GET_USER_TIMELINE: 'GET',
  ADMIN_BULK_DISABLE: 'POST',
  ADMIN_BULK_ENABLE: 'POST',
  ADMIN_BULK_CHANGE_PLAN: 'POST',
  ADMIN_BULK_LOGOUT: 'POST',
  ADMIN_GET_ANNOUNCEMENTS: 'GET',
  ADMIN_CREATE_ANNOUNCEMENT: 'POST',
  ADMIN_UPDATE_ANNOUNCEMENT: 'POST',
  ADMIN_DELETE_ANNOUNCEMENT: 'POST',
  ADMIN_GET_REPORTS: 'GET',
  ADMIN_GET_CONFIGS: 'GET',
  ADMIN_UPDATE_CONFIG: 'POST',
  ADMIN_RESOLVE_REPORT: 'POST',
  ADMIN_APPLY_STRIKE: 'POST',
  ADMIN_GET_CONTENT_REPORTS: 'GET',
  ANNOUNCEMENTS_GET_ACTIVE: 'GET',
  GET_FEATURE_FLAGS_PUBLIC: 'GET',
  GET_RUNTIME_CONFIG_PUBLIC: 'GET',

  // ============================================
  // USER
  // ============================================
  USER_CHANGE_NAME: 'POST',
  USER_REQUEST_EMAIL_CHANGE: 'POST',
  USER_REQUEST_DELETE: 'POST',
  USER_DELETE_ANY: 'POST',
  ADMIN_PURGE_DELETED_USER: 'POST',
  USER_DISABLE_SELF: 'POST',
  USER_DISABLE_ANY: 'POST',
  USER_ENABLE_ANY: 'POST',
  USER_ONBOARD_AS_STYLIST: 'POST',
  USER_ONBOARD_AS_CLIENT: 'POST',
  USER_GET_ACCOUNT_STATE: 'GET',
  USER_GET_USAGE_STATS: 'GET',
  USER_SWITCH_ROLE: 'POST',
  USER_CHECK_RECOVERY: 'POST',
  USER_RESTORE_ACCOUNT: 'POST',
  USER_REACTIVATE_ACCOUNT: 'POST',
  USER_GDPR_ERASE: 'POST',
  USER_EXPORT_DATA: 'POST',
  USER_UPDATE_NOTIFICATION_PREFERENCES: 'POST',

  // ============================================
  // ACCOUNT
  // ============================================
  ACCOUNT_DISPLAY_NAME_CHANGE: 'POST',
  UPDATE_STYLIST_PROFILE: 'POST',
  ACCOUNT_GET_STYLISTS_WITH_LOCATION: 'POST',
  ACCOUNT_GET_PUBLIC_PROFILE: 'GET',
  ACCOUNT_STRIPE_PORTAL: 'POST',
  ACCOUNT_CHECKOUT_SESSION: 'POST',
  ACCOUNT_PLAN_CHANGE: 'POST',
  ACCOUNT_VAT_INVOICE_DETAILS: 'POST',
  ACCOUNT_SET_AVATAR: 'POST',
  ACCOUNT_INCREMENT_VIEW: 'POST',
  ACCOUNT_SET_DASHBOARD_NOTE: 'POST',
  ACCOUNT_DISMISS_GALLERY_STRENGTH: 'POST',
  ACCOUNT_GET_DASHBOARD_NOTE: 'GET',
  ACCOUNT_GET_DASHBOARD_FEED: 'GET',

  // ============================================
  // GALLERY
  // ============================================
  CREATE_GALLERY_RECORD: 'POST',
  GET_GALLERY_RECORDS: 'GET',
  DELETE_ASSET_FROM_VENDOR: 'POST',
  UPDATE_GALLERY_RECORD: 'POST',
  DELETE_GALLERY_RECORD: 'POST',
  GET_GALLERY_RECORD_BY_ID: 'GET',
  PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT: 'GET',
  GALLERY_GET_FOR_PAIRED_CLIENT: 'GET',
  GALLERY_PIN_RECORD: 'POST',
  GALLERY_UNPIN_RECORD: 'POST',
  EXPLORE_GALLERY_RECORDS: 'GET',
  REPORT_GALLERY_RECORD: 'POST',
  PUBLIC_GET_SITEMAP_PROFILES: 'GET',
  GET_COLORS: 'GET',
  GET_TRAITS: 'GET',

  // ============================================
  // FAVORITES
  // ============================================
  BOOKMARK_STYLIST: 'POST',
  UNBOOKMARK_STYLIST: 'POST',
  GET_BOOKMARKED_STYLISTS: 'GET',
  FAVORITE_ADD_RECORD: 'POST',
  FAVORITE_REMOVE_RECORD: 'POST',
  FAVORITE_GET_RECORDS: 'GET',
  FAVORITE_UPDATE_RECORD_NOTE: 'POST',
  FAVORITE_GET_GROUPED: 'GET',

  // ============================================
  // PAIRING
  // ============================================
  PAIRING_SESSION_ISSUE: 'POST',
  PAIRING_SESSION_CLAIM: 'POST',
  PAIRING_SESSION_REVOKE: 'POST',
  PAIRING_SESSION_REVOKE_ALL: 'POST',
  PAIRING_ACCESS_REVOKE: 'POST',
  PAIRING_GET_ACCESS_STATUS: 'GET',
  PAIRING_GET_MY_PAIRS: 'GET',
  PAIR_REQUEST_CREATE: 'POST',
  PAIR_REQUEST_RESPOND: 'POST',
  PAIR_REQUEST_CANCEL: 'POST',
  PAIRING_GET_PENDING_REQUESTS: 'GET',

  // ============================================
  // EVENT LOG
  // ============================================
  EVENT_LOG_GET_ALL: 'GET',

  // ============================================
  // CLIENT
  // ============================================
  CLIENT_UPDATE_CONTACT: 'POST',
  CLIENT_GET_PROFILE: 'GET',
  CLIENT_GET_CONTACT_FOR_STYLIST: 'GET',
  CLIENT_GET_CRM_NOTE: 'GET',
  CLIENT_UPSERT_CRM_NOTE: 'POST',
  CLIENT_DELETE_CRM_NOTE: 'POST',

  // ============================================
  // VISIT
  // ============================================
  GET_CLIENT_VISITS: 'GET',
  CREATE_MANUAL_VISIT: 'POST',
  UPDATE_VISIT_NOTE: 'POST',
  ADD_VISIT_RESULT_PHOTO: 'POST',
  REMOVE_VISIT_RESULT_PHOTO: 'POST',
  DELETE_MANUAL_VISIT: 'POST',

  // ============================================
  // SALON STAFF
  // ============================================
  SALON_STAFF_GET_ALL: 'GET',
  SALON_STAFF_GET_BY_ID: 'GET',
  SALON_STAFF_INVITE: 'POST',
  SALON_STAFF_UPDATE_PERMISSIONS: 'PATCH',
  SALON_STAFF_REMOVE: 'DELETE',
  SALON_STAFF_GET_MY_INVITATIONS: 'GET',
  SALON_STAFF_RESPOND_INVITATION: 'POST',

  // ============================================
  // PRICING (Public)
  // ============================================
  PRICING_GET_PLANS: 'GET',

  // ============================================
  // SUPPORT (User)
  // ============================================
  SUPPORT_CREATE_THREAD: 'POST',
  SUPPORT_ADD_MESSAGE: 'POST',
  SUPPORT_GET_MY_THREADS: 'GET',
  SUPPORT_GET_THREAD_MESSAGES: 'GET',
  SUPPORT_GET_UNREAD_COUNT: 'GET',
  SUPPORT_MARK_THREAD_READ: 'POST',

  // Messaging (stylist<->client)
  MESSAGING_SEND: 'POST',
  MESSAGING_MARK_READ: 'POST',
  MESSAGING_GET_THREAD: 'GET',
  MESSAGING_GET_CONVERSATIONS: 'GET',
  MESSAGING_HIDE_CONVERSATION: 'POST',
  MESSAGING_UNHIDE_CONVERSATION: 'POST',

  // ============================================
  // SUPPORT (Admin)
  // ============================================
  SUPPORT_ADMIN_GET_ALL_THREADS: 'GET',
  SUPPORT_ADMIN_GET_THREAD_MESSAGES: 'GET',
  SUPPORT_ADMIN_REPLY: 'POST',
  SUPPORT_CHANGE_STATUS: 'POST',

  // ============================================
  // EMAIL & NEWSLETTER
  // ============================================
  NEWSLETTER_SUBSCRIBE: 'POST',
  // Multi-method by design: GET = footer-link click, POST = RFC 8058 One-Click.
  NEWSLETTER_UNSUBSCRIBE: 'GET',
  CONTACT_FORM_SUBMIT: 'POST',
  EMAIL_UPDATE_PREFERENCES: 'POST',
  EMAIL_GET_SCHEDULE: 'GET',
  EMAIL_GET_HISTORY: 'GET',

  // ============================================
  // CONFIRMATIONS (GET-as-Command from email links)
  // ============================================
  // DECISION (nie usuwaj tego komentarza):
  // CONFIRMATIONS namespace = GET endpoints triggered by clicking links from emails.
  // GET method chosen so email clients can prefetch/render link previews without side-effects
  // (token verification + idempotent operation). Token in query string is the auth surface.
  // EMAIL_UNSUBSCRIBE is the exception: the BACKEND handler
  // (api/v1/email/unsubscribe) is the POST mutation (One-Click daemons + the
  // frontend page both POST {token}). The GET 302-redirect lives on the FRONTEND
  // (ROUTES_FRONT.EMAIL_UNSUBSCRIBE), not as an API handler — so the backend SSOT
  // method here is POST. The other three below are genuine GET-as-Command.
  EMAIL_UNSUBSCRIBE: 'POST',
  NEWSLETTER_CONFIRM: 'GET',
  USER_DELETE_CONFIRM: 'GET',
  USER_EMAIL_CHANGE_CONFIRM: 'GET',

  // ============================================
  // PUBLIC
  // ============================================
  GET_PUBLIC_STYLISTS_LIST: 'GET',

  // ============================================
  // SESSION CONTAINER
  // ============================================
  SESSION_CONTAINER_CREATE: 'POST',
  SESSION_CONTAINER_ADD_PHOTO: 'POST',
  SESSION_CONTAINER_SHARE: 'POST',
  SESSION_CONTAINER_CLOSE: 'POST',
  SESSION_CONTAINER_GET_MY: 'GET',
  SESSION_CONTAINER_GET_BY_ID: 'GET',
  SESSION_CONTAINER_SET_NOTE: 'POST',
} as const);

export type ApiHttpMethod =
  (typeof API_HTTP_METHODS)[keyof typeof API_HTTP_METHODS];
