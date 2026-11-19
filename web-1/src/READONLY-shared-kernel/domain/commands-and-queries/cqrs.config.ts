import type { EVENT_INFO_TYPE } from './cqrs.types';
import { APP_EVENTS } from '../events/app-events.const';

// DECISION: the group lists are enumerated BY HAND so `Object.values` per group keeps
// `EVENTS[TYPE][GROUP][number]` a literal indexed-access shape for cqrs.types.ts. A NEW event GROUP
// in app-events.const.ts is invisible to the EVENT_*_TYPE unions until it is listed here in COMMANDS,
// QUERIES and INFO (empty `[]` where it has none); the symptom is a typecheck failure on the new
// event name although APP_EVENTS has it. A new event inside an existing group needs nothing here.
export const EVENTS = Object.freeze({
  COMMANDS: {
    APPLICATION: [],
    ADMIN: Object.values(APP_EVENTS.COMMANDS.ADMIN),
    USER: Object.values(APP_EVENTS.COMMANDS.USER),
    SESSION: Object.values(APP_EVENTS.COMMANDS.SESSION),
    ACCOUNT: Object.values(APP_EVENTS.COMMANDS.ACCOUNT),
    CLIENT: Object.values(APP_EVENTS.COMMANDS.CLIENT),
    EVENT_LOG: [],
    GALLERY: Object.values(APP_EVENTS.COMMANDS.GALLERY),
    FAVORITE: Object.values(APP_EVENTS.COMMANDS.FAVORITE),
    PAIRING: Object.values(APP_EVENTS.COMMANDS.PAIRING),
    SALON_STAFF: Object.values(APP_EVENTS.COMMANDS.SALON_STAFF),
    SALON_PROFILE: Object.values(APP_EVENTS.COMMANDS.SALON_PROFILE),
    NEWSLETTER: Object.values(APP_EVENTS.COMMANDS.NEWSLETTER),
    EMAIL: Object.values(APP_EVENTS.COMMANDS.EMAIL),
    PRICING: [],
    PUBLIC: Object.values(APP_EVENTS.COMMANDS.PUBLIC),
    SUPPORT: Object.values(APP_EVENTS.COMMANDS.SUPPORT),
    SESSION_CONTAINER: Object.values(APP_EVENTS.COMMANDS.SESSION_CONTAINER),
    VISIT: Object.values(APP_EVENTS.COMMANDS.VISIT),
    MESSAGING: Object.values(APP_EVENTS.COMMANDS.MESSAGING),
    NOTIFICATIONS: Object.values(APP_EVENTS.COMMANDS.NOTIFICATIONS),
  },
  // DECISION: CONFIRMATIONS is wrapped in a single synthetic LINK group to keep the
  // EVENTS[TYPE][GROUP][number] indexed-access shape cqrs.types.ts relies on. APP_EVENTS.CONFIRMATIONS
  // itself stays flat.
  CONFIRMATIONS: {
    LINK: Object.values(APP_EVENTS.CONFIRMATIONS),
  },
  QUERIES: {
    APPLICATION: Object.values(APP_EVENTS.QUERIES.APPLICATION),
    ADMIN: Object.values(APP_EVENTS.QUERIES.ADMIN),
    USER: Object.values(APP_EVENTS.QUERIES.USER),
    SESSION: Object.values(APP_EVENTS.QUERIES.SESSION),
    ACCOUNT: Object.values(APP_EVENTS.QUERIES.ACCOUNT),
    CLIENT: Object.values(APP_EVENTS.QUERIES.CLIENT),
    EVENT_LOG: Object.values(APP_EVENTS.QUERIES.EVENT_LOG),
    GALLERY: Object.values(APP_EVENTS.QUERIES.GALLERY),
    FAVORITE: Object.values(APP_EVENTS.QUERIES.FAVORITE),
    PAIRING: Object.values(APP_EVENTS.QUERIES.PAIRING),
    SALON_STAFF: Object.values(APP_EVENTS.QUERIES.SALON_STAFF),
    SALON_PROFILE: Object.values(APP_EVENTS.QUERIES.SALON_PROFILE),
    NEWSLETTER: [],
    EMAIL: Object.values(APP_EVENTS.QUERIES.EMAIL),
    PRICING: Object.values(APP_EVENTS.QUERIES.PRICING),
    PUBLIC: Object.values(APP_EVENTS.QUERIES.PUBLIC),
    SUPPORT: Object.values(APP_EVENTS.QUERIES.SUPPORT),
    SESSION_CONTAINER: Object.values(APP_EVENTS.QUERIES.SESSION_CONTAINER),
    VISIT: Object.values(APP_EVENTS.QUERIES.VISIT),
    MESSAGING: Object.values(APP_EVENTS.QUERIES.MESSAGING),
    NOTIFICATIONS: Object.values(APP_EVENTS.QUERIES.NOTIFICATIONS),
  },
  INFO: {
    APPLICATION: Object.values(APP_EVENTS.INFO.APPLICATION),
    ADMIN: Object.values(APP_EVENTS.INFO.ADMIN),
    USER: Object.values(APP_EVENTS.INFO.USER),
    SESSION: Object.values(APP_EVENTS.INFO.SESSION),
    ACCOUNT: Object.values(APP_EVENTS.INFO.ACCOUNT),
    CLIENT: Object.values(APP_EVENTS.INFO.CLIENT),
    EVENT_LOG: [],
    GALLERY: Object.values(APP_EVENTS.INFO.GALLERY),
    FAVORITE: Object.values(APP_EVENTS.INFO.FAVORITE),
    PAIRING: Object.values(APP_EVENTS.INFO.PAIRING),
    SALON_STAFF: Object.values(APP_EVENTS.INFO.SALON_STAFF),
    SALON_PROFILE: Object.values(APP_EVENTS.INFO.SALON_PROFILE),
    PRICING: Object.values(APP_EVENTS.INFO.PRICING),
    NEWSLETTER: Object.values(APP_EVENTS.INFO.NEWSLETTER),
    EMAIL: Object.values(APP_EVENTS.INFO.EMAIL),
    PUBLIC: Object.values(APP_EVENTS.INFO.PUBLIC),
    SUPPORT: Object.values(APP_EVENTS.INFO.SUPPORT),
    SESSION_CONTAINER: Object.values(APP_EVENTS.INFO.SESSION_CONTAINER),
    VISIT: Object.values(APP_EVENTS.INFO.VISIT),
    MESSAGING: Object.values(APP_EVENTS.INFO.MESSAGING),
    NOTIFICATIONS: Object.values(APP_EVENTS.INFO.NOTIFICATIONS),
  },
} as const);

// Events that should NOT trigger snackbar/notifications on frontend.
export const eventsDisallowedForUI: Readonly<EVENT_INFO_TYPE[]> = Object.freeze(
  [
    APP_EVENTS.INFO.ACCOUNT.CHECKOUT_RESULT_FETCHED,
    APP_EVENTS.INFO.NOTIFICATIONS.NOTIFICATION_FETCHED,
    APP_EVENTS.INFO.MESSAGING.MESSAGING_OPENED,
    APP_EVENTS.INFO.MESSAGING.MESSAGING_CONTACT_ENDED,
    APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_ACCEPTED,
    APP_EVENTS.INFO.EMAIL.EMAIL_LIFECYCLE_ENTRY_RECORDED,
    APP_EVENTS.INFO.EMAIL.EMAIL_LIFECYCLE_ACTIONS_FETCHED,
    APP_EVENTS.INFO.APPLICATION.SUCCESS,
    APP_EVENTS.INFO.ADMIN.NOTES_FETCHED,
    APP_EVENTS.INFO.USER.USER_ALREADY_EXISTS,
    APP_EVENTS.INFO.USER.USER_NOT_FOUND,
    APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_CREATED,

    // Suppress noisy query-success events (fetch confirmations)
    APP_EVENTS.INFO.USER.ACCOUNT_STATE_FETCHED,
    APP_EVENTS.INFO.ACCOUNT.PUBLIC_PROFILE_FETCHED,
    // Analytics fire-and-forget: a "profile view counted" toast is pure noise for the visitor.
    APP_EVENTS.INFO.ACCOUNT.PROFILE_VIEW_INCREMENTED,
    APP_EVENTS.INFO.ACCOUNT.STYLISTS_WITH_LOCATION_FETCHED,
    // Dismissing the "Gallery strength" card is its own confirmation: the card disappears. A
    // "card closed" toast over the empty spot is noise.
    APP_EVENTS.INFO.ACCOUNT.GALLERY_STRENGTH_DISMISSED,
    APP_EVENTS.INFO.GALLERY.PUBLIC_GALLERY_RECORDS_FETCHED,
    APP_EVENTS.INFO.GALLERY.SITEMAP_PROFILES_FETCHED,
    APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_FETCHED,
    // Pin manager: reading and reordering are silent. Moving a row IS its own confirmation (a
    // frequent action, Style Policy 46); a toast per arrow click would be noise.
    APP_EVENTS.INFO.GALLERY.GALLERY_PINNED_RECORDS_FETCHED,
    APP_EVENTS.INFO.GALLERY.GALLERY_PINNED_ORDER_UPDATED,
    APP_EVENTS.INFO.FAVORITE.BOOKMARKED_STYLISTS_FETCHED,
    APP_EVENTS.INFO.FAVORITE.FAVORITE_RECORDS_FETCHED,
    APP_EVENTS.INFO.PAIRING.PAIRING_ACCESS_STATUS_FETCHED,
    APP_EVENTS.INFO.PAIRING.PAIRING_PAIRS_FETCHED,
    // The requests query fires on every visit to /app/pairing; a "requests fetched" toast is noise.
    APP_EVENTS.INFO.PAIRING.PENDING_REQUESTS_FETCHED,
    // The request funnel has its OWN feedback in the components (inline banner + PENDING badge for
    // the client; "client connected" snackbar + the section disappearing for the stylist); the
    // event bus would double it with a second toast.
    APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT,
    APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_ACCEPTED,
    APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_DECLINED,
    APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_CANCELLED,
    APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_FETCHED,
    APP_EVENTS.INFO.SALON_PROFILE.SALON_PROFILE_FETCHED,
    APP_EVENTS.INFO.SALON_PROFILE.SALON_PROFILE_UPDATED,
    APP_EVENTS.INFO.SALON_PROFILE.SALON_PROFILE_VISIBILITY_UPDATED,
    // Salon-team invitations (invitee side): the list query runs on every visit
    // to the screen, and the answer has its own feedback in the screen (the card
    // leaves the list), like the pair-request funnel above. A global toast on top
    // would say the same thing twice.
    APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATIONS_FETCHED,
    // The invite hook owns the informative success toast.
    APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITED,
    APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_REMOVED,
    APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATION_ACCEPTED,
    APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATION_DECLINED,
    APP_EVENTS.INFO.CLIENT.CLIENT_PROFILE_FETCHED,
    APP_EVENTS.INFO.CLIENT.CLIENT_CONTACT_FETCHED,
    APP_EVENTS.INFO.CLIENT.CLIENT_CRM_NOTE_FETCHED,
    APP_EVENTS.INFO.CLIENT.CLIENT_IMPORTANT_NOTE_FETCHED,
    APP_EVENTS.INFO.VISIT.CLIENT_VISITS_FETCHED,

    // Suppress admin query-success events
    APP_EVENTS.INFO.ADMIN.LOG_GROUPS_FETCHED,
    APP_EVENTS.INFO.ADMIN.LOG_DETAILS_FETCHED,
    APP_EVENTS.INFO.ADMIN.ADMIN_PERMISSIONS_FETCHED,
    APP_EVENTS.INFO.ADMIN.FEATURE_FLAGS_FETCHED,
    APP_EVENTS.INFO.ADMIN.IMPERSONATION_REFRESHED,
    APP_EVENTS.INFO.ADMIN.ADMIN_USERS_PAGINATED_FETCHED,
    APP_EVENTS.INFO.ADMIN.ADMIN_METRICS_FETCHED,
    APP_EVENTS.INFO.ADMIN.ADMIN_ATTENTION_COUNTS_FETCHED,
    APP_EVENTS.INFO.ADMIN.ADMIN_HEALTH_FETCHED,
    APP_EVENTS.INFO.ADMIN.ADMIN_CHECK_ACCESS_HEALTH_FETCHED,
    APP_EVENTS.INFO.ADMIN.AUDIT_TRAIL_FETCHED,
    APP_EVENTS.INFO.ADMIN.ADMIN_AI_CRAWLER_STATS_RETURNED,
    APP_EVENTS.INFO.ADMIN.ADMIN_AI_CRAWLER_LIST_RETURNED,
    APP_EVENTS.INFO.ADMIN.USER_TIMELINE_FETCHED,
    APP_EVENTS.INFO.ADMIN.ANNOUNCEMENTS_FETCHED,
    APP_EVENTS.INFO.ADMIN.REPORTS_FETCHED,
    APP_EVENTS.INFO.ADMIN.CONFIGS_FETCHED,
    APP_EVENTS.INFO.ADMIN.POLICIES_FETCHED,
    APP_EVENTS.INFO.APPLICATION.ACTIVE_ANNOUNCEMENTS_FETCHED,
    APP_EVENTS.INFO.APPLICATION.PUBLIC_RUNTIME_CONFIG_FETCHED,

    // Suppress role-switch confirmation (user sees UI change already)
    APP_EVENTS.INFO.USER.USER_ROLE_SWITCHED,

    // Onboarding ends in its OWN terminal success view ("Wszystko gotowe"), so the backend event
    // "client account created" would double it with a toast on the same screen.
    // CLIENT_ACCOUNT_CREATED fires ONLY from onboard-client, so it is always redundant.
    // STYLIST_ACCOUNT_CREATED deliberately STAYS off this list: the stylist lands on the checkout
    // step (not a success view), where it confirms progress before payment.
    APP_EVENTS.INFO.USER.CLIENT_ACCOUNT_CREATED,

    // Suppress platform gate (routing event, not user notification)
    APP_EVENTS.INFO.USER.PLATFORM_GATE,

    // Suppress post-login token-bridge transport events (variant C exchange-code).
    // These are programmatic transport signals — the frontend reads the bearer
    // token from the `authorization` response header and routes; failure is handled
    // by redirecting to login. Neither should surface a raw-event snackbar.
    APP_EVENTS.INFO.USER.LOGIN_TOKEN_EXCHANGED,
    APP_EVENTS.INFO.USER.LOGIN_TOKEN_EXCHANGE_FAILED,

    // Suppress gallery fetch confirmations (noisy on gallery page load)
    APP_EVENTS.INFO.GALLERY.COLORS_FETCHED,
    APP_EVENTS.INFO.GALLERY.TRAITS_FETCHED,
    APP_EVENTS.INFO.GALLERY.EXPLORE_GALLERY_RECORDS_FETCHED,
    APP_EVENTS.INFO.GALLERY.GALLERY_FOR_PAIRED_CLIENT_FETCHED,

    // Suppress public & favorites query-success events
    APP_EVENTS.INFO.PUBLIC.PUBLIC_STYLISTS_LIST_FETCHED,
    APP_EVENTS.INFO.FAVORITE.FAVORITE_GROUPED_FETCHED,

    // Suppress pricing query-success events
    APP_EVENTS.INFO.PRICING.PRICING_PLANS_FETCHED,

    // Suppress email query-success events
    APP_EVENTS.INFO.EMAIL.EMAIL_SCHEDULE_FETCHED,
    APP_EVENTS.INFO.EMAIL.EMAIL_HISTORY_FETCHED,

    // Suppress session-container query-success events (noisy on /app/sessions polling)
    APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_FETCHED,
    APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINERS_FETCHED,
    APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_INSIGHTS_FETCHED,

    // Suppress support query-success events
    APP_EVENTS.INFO.SUPPORT.SUPPORT_THREADS_FETCHED,
    APP_EVENTS.INFO.SUPPORT.SUPPORT_MESSAGES_FETCHED,
    APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_THREADS_FETCHED,
    APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_MESSAGES_FETCHED,
    // Badge poll and the silent read marker written on opening a thread.
    APP_EVENTS.INFO.SUPPORT.SUPPORT_UNREAD_COUNT_FETCHED,
    APP_EVENTS.INFO.SUPPORT.SUPPORT_THREAD_MARKED_READ,

    // Suppress messaging success/fetch events: the messenger has its own UI feedback (the message
    // appears in the stream, the unread badge updates from the list); a toast per send/fetch/
    // mark-read is noise.
    APP_EVENTS.INFO.MESSAGING.MESSAGING_MESSAGE_SENT,
    APP_EVENTS.INFO.MESSAGING.MESSAGING_MARKED_READ,
    APP_EVENTS.INFO.MESSAGING.MESSAGING_THREAD_FETCHED,
    APP_EVENTS.INFO.MESSAGING.MESSAGING_CONVERSATIONS_FETCHED,

    // Notification centre (v2): the bell polls the count, the list marks itself
    // read on open, and the push opt-in row shows its own completion line, so
    // none of these needs a toast (Style Policy 46: reads and frequent actions
    // stay quiet; a device switch confirms itself in place).
    APP_EVENTS.INFO.NOTIFICATIONS.NOTIFICATIONS_FETCHED,
    APP_EVENTS.INFO.NOTIFICATIONS.NOTIFICATIONS_UNREAD_COUNT_FETCHED,
    APP_EVENTS.INFO.NOTIFICATIONS.NOTIFICATIONS_MARKED_READ,
    APP_EVENTS.INFO.NOTIFICATIONS.PUSH_SUBSCRIPTION_REGISTERED,
    APP_EVENTS.INFO.NOTIFICATIONS.PUSH_SUBSCRIPTION_UNREGISTERED,

    // Suppress dashboard & moderation query-success events. GET fetch-confirmations are event-log
    // telemetry, NOT user notifications, same rule as the *_FETCHED entries above.
    APP_EVENTS.INFO.ACCOUNT.DASHBOARD_FEED_FETCHED,
    APP_EVENTS.INFO.ACCOUNT.DASHBOARD_NOTE_FETCHED,
    APP_EVENTS.INFO.ADMIN.CONTENT_REPORTS_FETCHED,

    // Suppress data-export success: DataExportSection shows its OWN platform-aware toast (web: the
    // downloaded file name, native: clipboard). A generic "data exported" toast would double it
    // and not say WHERE the data went (owner).
    APP_EVENTS.INFO.USER.USER_DATA_EXPORTED,
  ] as const
);

const _disallowedEventsLookup = new Set<string>(
  eventsDisallowedForUI as readonly string[]
);

export const isEventDisallowedForUI = (event: unknown): boolean =>
  Boolean(event) === false || _disallowedEventsLookup.has(event as string);
