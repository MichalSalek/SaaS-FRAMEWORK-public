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
   * Web-home of the `/app` zone: the start screen for a logged-in DESKTOP user. The product is
   * mobile-only, so a laptop gets a "take it to your phone" banner (the same hero as `/get-app`)
   * plus account shortcuts, instead of landing in the settings form. Access category: account-route
   * (`route-access.policy`), so it is NOT bounced to `/get-app`.
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
  /** One section of the account screen opened as its own page. */
  USER_ACCOUNT_SECTION: '/app/user/account/[section]',
  USER_ACTIVITY_LOG: '/app/user/activity',
  USER_ACTIVATE_CLIENT: '/app/user/activate-client',
  USER_ACTIVATE_STYLIST: '/app/user/activate-stylist',
  USER_RECOVER: '/app/user/recover',

  GALLERY_UPLOAD_ASSET: '/app/gallery/upload-asset',
  GALLERY: '/app/gallery',

  FAVORITES: '/app/favorites',
  STYLISTS: '/app/stylists',

  // Stylist<->client messenger: conversation list + a thread per pair.
  MESSAGES: '/app/messages',
  MESSAGES_THREAD: '/app/messages/[pairId]',
  SHARED: '/app/shared',
  /**
   * The stylist's own clients: the list, waiting connection requests and what
   * needs her attention (owner). Until then the list lived under
   * the QR code on `PAIRING`, a screen she turns towards a client.
   */
  CLIENTS: '/app/clients',
  CLIENT_CARD: '/app/clients/[id]',
  CLIENT_PROFILE: '/app/client-profile',
  PAIRING: '/app/pairing',

  /**
   * Managing the stylist's PUBLIC profile from inside the app: a preview of what
   * the client sees, editing the profile card and choosing pinned photos.
   * A separate route from `/stylist/[identifier]` (that one is public, in PublicLayout
   * without the bottom bar, so entering it from the app left the user with no way
   * back; see the DECISION in `appDrawerSections.tsx`).
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
  SALON_INVITATION_ACCEPT: '/salon-invitation',
  SALON_PUBLIC: '/salon/[id]',
  SUPPORT: '/app/user/support',
  SUPPORT_THREAD: '/app/user/support/[threadId]',
  /** New-request form and the list of own threads as separate pages. */
  SUPPORT_NEW: '/app/user/support/new',
  SUPPORT_THREADS: '/app/user/support/threads',
  /**
   * Notification centre: the recent notifications of both roles, the target of the bell and of a
   * push tap. Account-route (`route-access.policy`), so a push tapped on a laptop reaches the list.
   */
  NOTIFICATIONS: '/app/notifications',
  NOTIFICATION_OPEN: '/app/notifications/open',
  /**
   * The stylist's private notes: her general note, her notes about
   * clients, the notes of Inspiration Sessions and of visits, in one place.
   * Stylist only. A product route like `CLIENTS`, because its rows open the
   * client card and the session screen.
   */
  NOTES: '/app/notes',
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
  // ADMIN_PURGE_DELETED_USER — Art.17 hard-purge DeletedUser archive (POST, MASTER_ADMIN)

  // Dev only
  DEV_LOGIN: '/api/auth/dev-login',

  // Post-login token bridge (variant C). Public pre-auth: redeems the one-time
  // ?authCode minted by the auth after-hook for the session bearer token (returned
  // in the `authorization` response header). Lives under /api/auth/ (NOT /api/v1/)
  // alongside Better Auth + dev-login → inherits the strict rate-limit prefix.
  AUTH_EXCHANGE_CODE: '/api/auth/exchange-code',

  // DECISION: see app-events.const.ts (UPDATE_STYLIST_PROFILE as one atomic endpoint).
  // Plan-choice dispatcher (Free | embedded Payment Element | hosted fallback): the only payment
  // entry point.
  // Quick paid->paid plan change (subscription.update with proration, SCA inline).
  // VAT invoice: store the buyer's company details on the Stripe Customer before confirm().
  // Stylist profile photo: set and clear on one route (payload `avatar_url: null` = back to the
  // OAuth/initials fallback).

  // Key === CQRS event / DTO op / http-method key (EXPLORE_GALLERY_RECORDS) — pure
  // equality join; URL path unchanged for API stability. Alias to GALLERY_EXPLORE dropped.

  // <generated:contracts:routes> from the API contracts by `npm run system:contracts`; do not edit
  BOOKMARK_STYLIST: `${API_VER}bookmark/bookmark-stylist`,
  UNBOOKMARK_STYLIST: `${API_VER}bookmark/unbookmark-stylist`,
  GET_BOOKMARKED_STYLISTS: `${API_VER}bookmark/get-bookmarked`,
  FAVORITE_ADD_RECORD: `${API_VER}favorite/add-record`,
  FAVORITE_REMOVE_RECORD: `${API_VER}favorite/remove-record`,
  FAVORITE_GET_RECORDS: `${API_VER}favorite/get-records`,
  FAVORITE_UPDATE_RECORD_NOTE: `${API_VER}favorite/update-record-note`,
  FAVORITE_GET_GROUPED: `${API_VER}favorite/get-grouped`,
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
  NOTIFICATIONS_GET_ONE: `${API_VER}notifications/get-one`,
  NOTIFICATIONS_GET_RECENT: `${API_VER}notifications/recent`,
  NOTIFICATIONS_GET_UNREAD_COUNT: `${API_VER}notifications/unread-count`,
  NOTIFICATIONS_MARK_READ: `${API_VER}notifications/mark-read`,
  PUSH_SUBSCRIPTION_REGISTER: `${API_VER}notifications/push/register`,
  PUSH_SUBSCRIPTION_UNREGISTER: `${API_VER}notifications/push/unregister`,
  SESSION_CONTAINER_ACCEPT: `${API_VER}session-container/accept`,
  SESSION_CONTAINER_CREATE: `${API_VER}session-container/create`,
  SESSION_CONTAINER_ADD_PHOTO: `${API_VER}session-container/add-photo`,
  SESSION_CONTAINER_REMOVE_PHOTO: `${API_VER}session-container/remove-photo`,
  SESSION_CONTAINER_SHARE: `${API_VER}session-container/share`,
  SESSION_CONTAINER_CLOSE: `${API_VER}session-container/close`,
  SESSION_CONTAINER_SET_NOTE: `${API_VER}session-container/set-note`,
  SESSION_CONTAINER_GET_MY: `${API_VER}session-container/get-my`,
  SESSION_CONTAINER_DUPLICATE: `${API_VER}session-container/duplicate`,
  SESSION_CONTAINER_INSIGHTS: `${API_VER}session-container/insights`,
  SESSION_CONTAINER_GET_BY_ID: `${API_VER}session-container/get-by-id`,
  MESSAGING_END_CONTACT: `${API_VER}messaging/end-contact`,
  MESSAGING_OPEN: `${API_VER}messaging/open`,
  MESSAGING_SEND: `${API_VER}messaging/send`,
  MESSAGING_MARK_READ: `${API_VER}messaging/mark-read`,
  MESSAGING_HIDE_CONVERSATION: `${API_VER}messaging/hide`,
  MESSAGING_UNHIDE_CONVERSATION: `${API_VER}messaging/unhide`,
  MESSAGING_GET_THREAD: `${API_VER}messaging/thread`,
  MESSAGING_GET_CONVERSATIONS: `${API_VER}messaging/conversations`,
  CLIENT_UPDATE_CONTACT: `${API_VER}client/update-contact`,
  CLIENT_GET_PROFILE: `${API_VER}client/profile`,
  CLIENT_GET_CONTACT_FOR_STYLIST: `${API_VER}client/contact/get-for-stylist`,
  CLIENT_GET_CRM_NOTE: `${API_VER}client/crm-note/get`,
  CLIENT_UPSERT_CRM_NOTE: `${API_VER}client/crm-note/upsert`,
  CLIENT_DELETE_CRM_NOTE: `${API_VER}client/crm-note/delete`,
  CLIENT_GET_IMPORTANT_NOTE: `${API_VER}client/important-note/get`,
  CLIENT_UPSERT_IMPORTANT_NOTE: `${API_VER}client/important-note/upsert`,
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
  PAIRING_RESOLVE_PLACE: `${API_VER}pairing/resolve-place`,
  PAIRING_GET_PENDING_REQUESTS: `${API_VER}pairing/pending-requests`,
  PAIRING_GET_MY_PENDING_REQUESTS: `${API_VER}pairing/my-pending-requests`,
  NEWSLETTER_SUBSCRIBE: `${API_VER}public/newsletter-subscribe`,
  EMAIL_UPDATE_PREFERENCES: `${API_VER}email/update-preferences`,
  EMAIL_LIFECYCLE_ENTRY: `${API_VER}email/lifecycle-entry`,
  EMAIL_GET_SCHEDULE: `${API_VER}email/get-schedule`,
  EMAIL_LIFECYCLE_ACTIONS: `${API_VER}email/lifecycle-actions`,
  EMAIL_GET_HISTORY: `${API_VER}email/get-history`,
  CONTACT_FORM_SUBMIT: `${API_VER}public/contact-form`,
  GET_PUBLIC_STYLISTS_LIST: `${API_VER}stylist/get-public-list`,
  EVENT_LOG_GET_ALL: `${API_VER}event-log/get-all`,
  PRICING_GET_PLANS: `${API_VER}pricing/get-plans`,
  PRICING_GET_MARKET: `${API_VER}pricing/get-market`,
  ANNOUNCEMENTS_GET_ACTIVE: `${API_VER}announcements/active`,
  GET_RUNTIME_CONFIG_PUBLIC: `${API_VER}runtime-config`,
  SEND_LOG: `${API_VER}admin/send-log`,
  SWITCH_BACKEND_DEBUG_MODE: `${API_VER}admin/debug-mode`,
  BECOME_USER: `${API_VER}admin/become-user`,
  SWITCH_BACK_BECOME_USER: `${API_VER}admin/switch-back-become-user`,
  REFRESH_IMPERSONATION: `${API_VER}admin/refresh-impersonation`,
  SAVE_NOTE: `${API_VER}admin/save-note`,
  SET_MAIN_NOTE: `${API_VER}admin/set-main-note`,
  ADMIN_SAVE_POLICY: `${API_VER}admin/save-policy`,
  ADMIN_DELETE_POLICY: `${API_VER}admin/delete-policy`,
  ADMIN_SET_MAIN_POLICY: `${API_VER}admin/set-main-policy`,
  ADMIN_CHECK_ACCESS: `${API_VER}admin/check-access/url`,
  ADMIN_CHANGE_PRICING_PLAN: `${API_VER}admin/user/change-pricing-plan`,
  ADMIN_UPDATE_PERMISSIONS: `${API_VER}admin/permissions/update`,
  ADMIN_CREATE_COLOR: `${API_VER}admin/create-color`,
  ADMIN_UPDATE_COLOR: `${API_VER}admin/update-color`,
  ADMIN_DELETE_COLOR: `${API_VER}admin/delete-color`,
  ADMIN_CREATE_TRAIT: `${API_VER}admin/create-trait`,
  ADMIN_UPDATE_TRAIT: `${API_VER}admin/update-trait`,
  ADMIN_DELETE_TRAIT: `${API_VER}admin/delete-trait`,
  ADMIN_TOGGLE_FEATURE_FLAG: `${API_VER}admin/feature-flags/toggle`,
  ADMIN_BULK_DISABLE: `${API_VER}admin/users/bulk-disable`,
  ADMIN_BULK_ENABLE: `${API_VER}admin/users/bulk-enable`,
  ADMIN_BULK_CHANGE_PLAN: `${API_VER}admin/users/bulk-change-plan`,
  ADMIN_BULK_LOGOUT: `${API_VER}admin/users/bulk-logout`,
  ADMIN_CREATE_ANNOUNCEMENT: `${API_VER}admin/announcements/create`,
  ADMIN_UPDATE_ANNOUNCEMENT: `${API_VER}admin/announcements/update`,
  ADMIN_DELETE_ANNOUNCEMENT: `${API_VER}admin/announcements/delete`,
  ADMIN_SEND_ANNOUNCEMENT_NOTIFICATION: `${API_VER}admin/announcements/send-notification`,
  ADMIN_TEST_ANNOUNCEMENT_NOTIFICATION: `${API_VER}admin/announcements/test-notification`,
  ADMIN_UPDATE_CONFIG: `${API_VER}admin/config/update`,
  ADMIN_RESOLVE_REPORT: `${API_VER}admin/moderation/resolve-report`,
  ADMIN_APPLY_STRIKE: `${API_VER}admin/moderation/apply-strike`,
  ADMIN_PURGE_DELETED_USER: `${API_VER}admin/deleted-user/purge`,
  ADMIN_SET_LOG_ISSUE_STATUS: `${API_VER}admin/log-issue-status`,
  ADMIN_GET_PERMISSIONS: `${API_VER}admin/permissions`,
  GET_LOGS: `${API_VER}admin/get-logs`,
  GET_NOTES: `${API_VER}admin/get-notes`,
  ADMIN_GET_POLICIES: `${API_VER}admin/get-policies`,
  ADMIN_GET_USERS_PAGINATED: `${API_VER}admin/users`,
  ADMIN_GET_FEATURE_FLAGS: `${API_VER}admin/feature-flags`,
  ADMIN_GET_METRICS: `${API_VER}admin/metrics`,
  ADMIN_GET_ATTENTION_COUNTS: `${API_VER}admin/attention-counts`,
  ADMIN_HEALTH: `${API_VER}admin/health`,
  ADMIN_CHECK_ACCESS_HEALTH: `${API_VER}admin/check-access`,
  ADMIN_GET_AUDIT_TRAIL: `${API_VER}admin/audit-trail`,
  ADMIN_AI_CRAWLER_STATS: `${API_VER}admin/ai-crawler-stats`,
  ADMIN_AI_CRAWLER_LIST: `${API_VER}admin/ai-crawler-list`,
  ADMIN_GET_USER_TIMELINE: `${API_VER}admin/user-timeline`,
  ADMIN_GET_ANNOUNCEMENTS: `${API_VER}admin/announcements`,
  ADMIN_GET_REPORTS: `${API_VER}admin/reports`,
  ADMIN_GET_CONFIGS: `${API_VER}admin/config`,
  ADMIN_GET_CONTENT_REPORTS: `${API_VER}admin/moderation/reports`,
  ADMIN_GET_EMAIL_PREVIEW: `${API_VER}admin/mailing/preview`,
  ADMIN_GET_EMAIL_PIPELINE: `${API_VER}admin/mailing/pipeline`,
  GET_FEATURE_FLAGS_PUBLIC: `${API_VER}feature-flags`,
  ADMIN_GET_LOG_GROUPS: `${API_VER}admin/log-groups`,
  ADMIN_GET_LOG_DETAILS: `${API_VER}admin/log-details`,
  ADMIN_GET_EMAIL_HISTORY: `${API_VER}admin/email-history`,
  USER_SET_AVATAR: `${API_VER}user/set-avatar`,
  USER_CHANGE_NAME: `${API_VER}user/change-name`,
  USER_DISABLE_ANY: `${API_VER}admin/user/disable/any`,
  USER_DISABLE_SELF: `${API_VER}user/disable/self`,
  USER_ENABLE_ANY: `${API_VER}admin/user/enable/any`,
  USER_DELETE_ANY: `${API_VER}admin/user/delete/any`,
  USER_REQUEST_DELETE: `${API_VER}user/delete/self`,
  USER_ONBOARD_AS_STYLIST: `${API_VER}user/onboard-stylist`,
  USER_ONBOARD_AS_CLIENT: `${API_VER}user/onboard-client`,
  USER_SWITCH_ROLE: `${API_VER}user/switch-role`,
  USER_CHECK_RECOVERY: `${API_VER}user/check-recovery`,
  USER_RESTORE_ACCOUNT: `${API_VER}user/restore-account`,
  USER_REACTIVATE_ACCOUNT: `${API_VER}user/reactivate`,
  USER_GDPR_ERASE: `${API_VER}user/gdpr-erase`,
  USER_EXPORT_DATA: `${API_VER}user/export-data`,
  USER_UPDATE_NOTIFICATION_PREFERENCES: `${API_VER}user/update-notification-preferences`,
  USER_REQUEST_EMAIL_CHANGE: `${API_VER}user/change-email`,
  USER_GET_ACCOUNT_STATE: `${API_VER}user/account-state`,
  USER_GET_USAGE_STATS: `${API_VER}user/usage-stats`,
  USER_DELETE_CONFIRM: `${API_VER}user/delete/confirm`,
  USER_EMAIL_CHANGE_CONFIRM: `${API_VER}user/confirm-email-change`,
  SESSION_DELETE_ALL: `${API_VER}session/delete/all`,
  SESSION_DELETE_EXACTLY: `${API_VER}session/delete/exactly`,
  SESSION_GET_ALL: `${API_VER}session/get-all`,
  SESSION_GET_CURRENT: `${API_VER}session/get-current`,
  ACCOUNT_CHECKOUT_RESULT: `${API_VER}account/checkout-result`,
  ACCOUNT_BILLING_PROFILE: `${API_VER}account/billing-profile`,
  ACCOUNT_DISPLAY_NAME_CHANGE: `${API_VER}account/display-name-change`,
  UPDATE_STYLIST_PROFILE: `${API_VER}account/update-stylist-profile`,
  ACCOUNT_STRIPE_PORTAL: `${API_VER}stripe/portal`,
  ACCOUNT_CHECKOUT_SESSION: `${API_VER}account/checkout-session`,
  ACCOUNT_PLAN_CHANGE_PREVIEW: `${API_VER}account/plan-change-preview`,
  ACCOUNT_PLAN_CHANGE: `${API_VER}account/plan-change`,
  ACCOUNT_VAT_INVOICE_DETAILS: `${API_VER}account/vat-invoice-details`,
  ACCOUNT_INCREMENT_VIEW: `${API_VER}account/increment-view`,
  ACCOUNT_SET_DASHBOARD_NOTE: `${API_VER}account/set-dashboard-note`,
  ACCOUNT_SET_AVATAR: `${API_VER}account/set-avatar`,
  ACCOUNT_DISMISS_GALLERY_STRENGTH: `${API_VER}account/dismiss-gallery-strength`,
  ACCOUNT_GET_STYLISTS_WITH_LOCATION: `${API_VER}account/get-stylists-with-location`,
  ACCOUNT_GET_PUBLIC_PROFILE: `${API_VER}public/get-stylist-profile`,
  ACCOUNT_RESOLVE_PROFILE_LINK: `${API_VER}public/resolve-profile-link`,
  ACCOUNT_GET_DASHBOARD_FEED: `${API_VER}account/get-dashboard-feed`,
  ACCOUNT_GET_DASHBOARD_NOTE: `${API_VER}account/get-dashboard-note`,
  ACCOUNT_GET_PRIVATE_NOTES: `${API_VER}account/get-private-notes`,
  CREATE_GALLERY_RECORD: `${API_VER}gallery/create-gallery-record`,
  DELETE_ASSET_FROM_VENDOR: `${API_VER}gallery/delete-asset-from-vendor`,
  UPDATE_GALLERY_RECORD: `${API_VER}gallery/update-record`,
  DELETE_GALLERY_RECORD: `${API_VER}gallery/delete-record`,
  GALLERY_PIN_RECORD: `${API_VER}gallery/pin-record`,
  GALLERY_UNPIN_RECORD: `${API_VER}gallery/unpin-record`,
  GALLERY_REORDER_PINNED_RECORDS: `${API_VER}gallery/reorder-pinned-records`,
  REPORT_GALLERY_RECORD: `${API_VER}gallery/report`,
  GET_GALLERY_RECORDS: `${API_VER}gallery/get-gallery-records`,
  GET_GALLERY_RECORD_BY_ID: `${API_VER}gallery/get-record-by-id`,
  PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT: `${API_VER}public/get-gallery-by-account`,
  PUBLIC_GET_SITEMAP_PROFILES: `${API_VER}public/sitemap-profiles`,
  GET_COLORS: `${API_VER}gallery/colors`,
  GET_TRAITS: `${API_VER}gallery/traits`,
  EXPLORE_GALLERY_RECORDS: `${API_VER}gallery/explore`,
  GALLERY_GET_FOR_PAIRED_CLIENT: `${API_VER}gallery/get-for-paired-client`,
  GALLERY_GET_PINNED_RECORDS: `${API_VER}gallery/get-pinned-records`,
  SALON_PROFILE_SET_LOGO: `${API_VER}salon/profile/set-logo`,
  SALON_PROFILE_UPDATE: `${API_VER}salon/profile/update`,
  SALON_PROFILE_CONTACT: `${API_VER}salon/profile/contact`,
  SALON_PROFILE_VISIBILITY_UPDATE: `${API_VER}salon/profile/visibility`,
  SALON_GALLERY_GET: `${API_VER}salon/gallery`,
  SALON_GALLERY_PUBLIC_GET: `${API_VER}public/salon-gallery`,
  SALON_PROFILE_GET: `${API_VER}salon/profile`,
  SALON_PROFILE_SLUG_AVAILABLE: `${API_VER}salon/profile/slug-available`,
  SALON_PROFILE_VISIBILITY_GET: `${API_VER}salon/profile/visibility/get`,
  SALON_PROFILE_PUBLIC_GET: `${API_VER}public/salon-profile`,
  SALON_STAFF_INVITE: `${API_VER}salon/staff`,
  SALON_STAFF_GET_ALL: `${API_VER}salon/staff`,
  SALON_STAFF_REMOVE: `${API_VER}salon/staff/[staffId]/delete`,
  SALON_STAFF_UPDATE_PERMISSIONS: `${API_VER}salon/staff/[staffId]/update`,
  SALON_STAFF_RESPOND_INVITATION: `${API_VER}salon/invitations/respond`,
  SALON_STAFF_ACCEPT_TOKEN: `${API_VER}salon/invitations/token/accept`,
  SALON_STAFF_LEAVE_TEAM: `${API_VER}salon/team/leave`,
  SALON_STAFF_GET_BY_ID: `${API_VER}salon/staff/[staffId]`,
  SALON_STAFF_GET_MY_INVITATIONS: `${API_VER}salon/invitations`,
  SALON_STAFF_GET_MY_TEAM: `${API_VER}salon/team`,
  CREATE_MANUAL_VISIT: `${API_VER}visit/create-manual`,
  UPDATE_VISIT_NOTE: `${API_VER}visit/update-note`,
  ADD_VISIT_RESULT_PHOTO: `${API_VER}visit/result-photo/add`,
  REMOVE_VISIT_RESULT_PHOTO: `${API_VER}visit/result-photo/remove`,
  DELETE_MANUAL_VISIT: `${API_VER}visit/delete-manual`,
  GET_CLIENT_VISITS: `${API_VER}visit/client-visits`,
  // </generated:contracts:routes>

  // DECISION: SALON_STAFF is one shared key for GET (SALON_STAFF_GET_ALL) and POST (SALON_STAFF_INVITE):
  // both events are hosted on the same path (`salon/staff/index.ts` switches on req.method). The
  // frontend alias lives in `main/src/application/http/http.endpoints.ts` (ROUTE_ALIASES). REMOVE and
  // UPDATE_PERMISSIONS have their own keys because they use another path (`[staffId]`). The asymmetry
  // is deliberate: a duplicate SALON_STAFF_INVITE key would collide in buildEndpoints.
  SALON_STAFF: `${API_VER}salon/staff`,
  // Invitee side (2026-09-25): the invited stylist's own pending invitations and
  // her answer. Scoped by the session user, never by a salon id in the path.

  NEWSLETTER_CONFIRM: `${API_VER}public/newsletter-confirm/[token]`,
  NEWSLETTER_UNSUBSCRIBE: `${API_VER}public/newsletter-unsubscribe`,

  EMAIL_UNSUBSCRIBE: `${API_VER}email/unsubscribe`,

  // Stylist<->client messenger (one stream per pair).

  // Internal S2S — no user context, secret-header auth, raw handler (excluded from CQRS/validation flow).
  INTERNAL_TRACK_CRAWLER: `${API_VER}internal/track-crawler`,

  // DECISION: public no-auth health endpoint under /internal/ for consistency with the other
  // internal/* (S2S monitoring) endpoints. Better Stack reads the passive last-observed state of the
  // main pool from it; it runs no SQL (does not block Neon scale-to-zero) and is sanitized: no vendor
  // names, error details or connection info.
  INTERNAL_HEALTH_PUBLIC: `${API_VER}internal/health-public`,

  // DECISION: external clock for the maintenance sweeps (owner). Sweeps otherwise start
  // only on accepted API traffic, and the mail windows (onboarding 24-48 h, 2-day trial catch-up) passed
  // unseen on days without traffic. A Better Stack monitor calls this path; it wakes the database at
  // most once per 6 h and never in quiet hours, less than any accepted API request already does, hence
  // no secret (same as health-public).
  INTERNAL_SWEEP_TICK: `${API_VER}internal/sweep-tick`,
} as const);

export const CRITICAL_REDIRECTIONS_ON_EVENTS = Object.freeze({
  UNAUTHORIZED: ROUTES_FRONT.APP,
  ALREADY_LOGGED: ROUTES_FRONT.APP,
  // DECISION: SESSION_EXPIRED is reserved and not emitted by the backend today (see
  // common-errors.types.ts). Better Auth answers an expired session with 401 and the app layer emits
  // LOGIN_FIRST (-> USER_LOG), so this HOME entry is live wiring that never fires until an explicit
  // session-expiry hook exists. The target mismatch with LOGIN_FIRST is deliberate.
  SESSION_EXPIRED: ROUTES_FRONT.HOME,
  LOGIN_FIRST: ROUTES_FRONT.USER_LOG,
  PLATFORM_GATE: ROUTES_FRONT.GET_APP,
  // DECISION: USER_DISABLED -> USER_LOG is a graceful eviction of an inactive account (admin ban,
  // self-disable, soft-delete). account-state-guard answers every disallowed action with 403
  // USER_DISABLED (not 401, so Better Auth and the idle guard do not catch it); without this entry a
  // user with a valid token would sit in a half-broken /app shell under 403 snackbars. It is
  // UNCONDITIONAL (event-pipeline REDIRECT_UNCONDITIONAL) because RBAC still lets a banned user's role
  // routes through, and STATE_FULL_RESET clears the cached currentUser. There is no "account disabled"
  // screen, so the target is login. This is frontend UX eviction, not a security boundary; the token is
  // cleared by the AuthContext settled-null guard once disableUser_IO deletes the session rows.
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
