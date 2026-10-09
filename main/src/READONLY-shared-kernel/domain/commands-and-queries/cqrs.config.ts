import type { EVENT_INFO_TYPE } from './cqrs.types';
import { APP_EVENTS } from '../events/app-events.const';

// DECISION (nie usuwaj tego komentarza):
// The group lists below are enumerated BY HAND on purpose — `Object.values` per
// group keeps `EVENTS[TYPE][GROUP][number]` a literal indexed-access shape for
// cqrs.types.ts. Consequence: a NEW event GROUP added to app-events.const.ts is
// invisible to the EVENT_*_TYPE unions until it is listed here in COMMANDS,
// QUERIES and INFO (an empty `[]` where the group has no events of that kind).
// Symptom of forgetting: typecheck fails on the new event name although
// APP_EVENTS carries it (MESSAGING, 2026-07-16). A new EVENT inside an existing
// group needs nothing here.
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
    NEWSLETTER: Object.values(APP_EVENTS.COMMANDS.NEWSLETTER),
    EMAIL: Object.values(APP_EVENTS.COMMANDS.EMAIL),
    PRICING: [],
    PUBLIC: Object.values(APP_EVENTS.COMMANDS.PUBLIC),
    SUPPORT: Object.values(APP_EVENTS.COMMANDS.SUPPORT),
    SESSION_CONTAINER: Object.values(APP_EVENTS.COMMANDS.SESSION_CONTAINER),
    VISIT: Object.values(APP_EVENTS.COMMANDS.VISIT),
    MESSAGING: Object.values(APP_EVENTS.COMMANDS.MESSAGING),
  },
  // DECISION (nie usuwaj tego komentarza):
  // CONFIRMATIONS wrapped in single LINK group to preserve EVENTS[TYPE][GROUP][number]
  // indexed-access type shape used by EVENTS_TYPES/EVENTS_GROUPS in cqrs.types.ts.
  // APP_EVENTS.CONFIRMATIONS remains flat (user-facing namespace); only EVENTS internal
  // shape has the LINK wrapper for type-system symmetry with COMMANDS/QUERIES/INFO.
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
    NEWSLETTER: [],
    EMAIL: Object.values(APP_EVENTS.QUERIES.EMAIL),
    PRICING: Object.values(APP_EVENTS.QUERIES.PRICING),
    PUBLIC: Object.values(APP_EVENTS.QUERIES.PUBLIC),
    SUPPORT: Object.values(APP_EVENTS.QUERIES.SUPPORT),
    SESSION_CONTAINER: Object.values(APP_EVENTS.QUERIES.SESSION_CONTAINER),
    VISIT: Object.values(APP_EVENTS.QUERIES.VISIT),
    MESSAGING: Object.values(APP_EVENTS.QUERIES.MESSAGING),
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
    PRICING: Object.values(APP_EVENTS.INFO.PRICING),
    NEWSLETTER: Object.values(APP_EVENTS.INFO.NEWSLETTER),
    EMAIL: Object.values(APP_EVENTS.INFO.EMAIL),
    PUBLIC: Object.values(APP_EVENTS.INFO.PUBLIC),
    SUPPORT: Object.values(APP_EVENTS.INFO.SUPPORT),
    SESSION_CONTAINER: Object.values(APP_EVENTS.INFO.SESSION_CONTAINER),
    VISIT: Object.values(APP_EVENTS.INFO.VISIT),
    MESSAGING: Object.values(APP_EVENTS.INFO.MESSAGING),
  },
} as const);

// Events that should NOT trigger snackbar/notifications on frontend.
export const eventsDisallowedForUI: Readonly<EVENT_INFO_TYPE[]> = Object.freeze(
  [
    APP_EVENTS.INFO.APPLICATION.SUCCESS,
    APP_EVENTS.INFO.ADMIN.NOTES_FETCHED,
    APP_EVENTS.INFO.USER.USER_ALREADY_EXISTS,
    APP_EVENTS.INFO.USER.USER_NOT_FOUND,
    APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_CREATED,

    // Suppress noisy query-success events (fetch confirmations)
    APP_EVENTS.INFO.USER.ACCOUNT_STATE_FETCHED,
    APP_EVENTS.INFO.ACCOUNT.PUBLIC_PROFILE_FETCHED,
    // Analytics fire-and-forget: success toast 'Wyświetlenie profilu zostało
    // zliczone' to czysty noise dla odwiedzającego (census S26, public-profile)
    APP_EVENTS.INFO.ACCOUNT.PROFILE_VIEW_INCREMENTED,
    APP_EVENTS.INFO.ACCOUNT.STYLISTS_WITH_LOCATION_FETCHED,
    // Zamknięcie karty „Siła galerii" JEST swoim własnym potwierdzeniem: karta
    // znika. Toast „Zamknięto kartę" nad pustym miejscem to szum (klasa S43).
    APP_EVENTS.INFO.ACCOUNT.GALLERY_STRENGTH_DISMISSED,
    APP_EVENTS.INFO.GALLERY.PUBLIC_GALLERY_RECORDS_FETCHED,
    APP_EVENTS.INFO.GALLERY.SITEMAP_PROFILES_FETCHED,
    APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_FETCHED,
    APP_EVENTS.INFO.FAVORITE.BOOKMARKED_STYLISTS_FETCHED,
    APP_EVENTS.INFO.FAVORITE.FAVORITE_RECORDS_FETCHED,
    APP_EVENTS.INFO.PAIRING.PAIRING_ACCESS_STATUS_FETCHED,
    APP_EVENTS.INFO.PAIRING.PAIRING_PAIRS_FETCHED,
    // Stały kod QR: query próśb odpala się na każde wejście na /app/pairing,
    // toast "Pobrano prośby o połączenie" = szum (klasa S43/S50b)
    APP_EVENTS.INFO.PAIRING.PENDING_REQUESTS_FETCHED,
    // Lejek prośby ma WŁASNY feedback w komponentach (inline banner + badge
    // PENDING u klientki; snackbar "Klientka połączona" + zniknięcie sekcji
    // u stylistki) — event-bus dublował go drugim toastem (klasa S43, S51).
    APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT,
    APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_ACCEPTED,
    APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_DECLINED,
    APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_CANCELLED,
    APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_FETCHED,
    // Salon-team invitations (invitee side): the list query runs on every visit
    // to the screen, and the answer has its own feedback in the screen (the card
    // leaves the list), like the pair-request funnel above. A global toast on top
    // would say the same thing twice (class S43).
    APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATIONS_FETCHED,
    APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATION_ACCEPTED,
    APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATION_DECLINED,
    APP_EVENTS.INFO.CLIENT.CLIENT_PROFILE_FETCHED,
    APP_EVENTS.INFO.CLIENT.CLIENT_CONTACT_FETCHED,
    APP_EVENTS.INFO.CLIENT.CLIENT_CRM_NOTE_FETCHED,
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

    // Onboarding kończy się WŁASNYM terminalnym widokiem sukcesu („Wszystko
    // gotowe"), więc backendowy event „Konto klientki zostało utworzone"
    // dublował go drugim toastem NA TYM SAMYM ekranie (klasa S43/S51/S51c —
    // command-event z własnym UI-feedbackiem). CLIENT_ACCOUNT_CREATED odpala się
    // WYŁĄCZNIE z onboard-client → zawsze redundantny. STYLIST_ACCOUNT_CREATED
    // celowo ZOSTAJE poza listą: u stylistki ląduje na kroku checkout (nie na
    // widoku sukcesu), gdzie potwierdza postęp przed płatnością.
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

    // Suppress support query-success events
    APP_EVENTS.INFO.SUPPORT.SUPPORT_THREADS_FETCHED,
    APP_EVENTS.INFO.SUPPORT.SUPPORT_MESSAGES_FETCHED,
    APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_THREADS_FETCHED,
    APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_MESSAGES_FETCHED,
    // Badge poll and the silent read marker written on opening a thread.
    APP_EVENTS.INFO.SUPPORT.SUPPORT_UNREAD_COUNT_FETCHED,
    APP_EVENTS.INFO.SUPPORT.SUPPORT_THREAD_MARKED_READ,

    // Suppress messaging success/fetch events — komunikator ma własny UI-feedback
    // (wiadomość pojawia się w strumieniu, badge unread aktualizuje się z listy);
    // toast na każdą wysyłkę/fetch/mark-read = szum.
    APP_EVENTS.INFO.MESSAGING.MESSAGING_MESSAGE_SENT,
    APP_EVENTS.INFO.MESSAGING.MESSAGING_MARKED_READ,
    APP_EVENTS.INFO.MESSAGING.MESSAGING_THREAD_FETCHED,
    APP_EVENTS.INFO.MESSAGING.MESSAGING_CONVERSATIONS_FETCHED,

    // Suppress dashboard & moderation query-success events (S18 P1: leaked as
    // user-facing toast "Pobrano panel glowny" / "Pobrano notatke pulpitu" /
    // "Pobrano zgloszenia tresci"). GET fetch-confirmations are event-log
    // telemetry, NOT user notifications — same rule as the *_FETCHED entries above.
    APP_EVENTS.INFO.ACCOUNT.DASHBOARD_FEED_FETCHED,
    APP_EVENTS.INFO.ACCOUNT.DASHBOARD_NOTE_FETCHED,
    APP_EVENTS.INFO.ADMIN.CONTENT_REPORTS_FETCHED,

    // Suppress data-export success — komponent DataExportSection pokazuje
    // WŁASNY, platform-aware toast (web: nazwa pobranego pliku, native:
    // schowek). Generyczny event-bus toast „Dane zostały wyeksportowane"
    // dublował się z nim i nie mówił, GDZIE dane trafiły (owner 2026-07-11).
    APP_EVENTS.INFO.USER.USER_DATA_EXPORTED,
  ] as const
);

const _disallowedEventsLookup = new Set<string>(
  eventsDisallowedForUI as readonly string[]
);

export const isEventDisallowedForUI = (event: unknown): boolean =>
  Boolean(event) === false || _disallowedEventsLookup.has(event as string);
