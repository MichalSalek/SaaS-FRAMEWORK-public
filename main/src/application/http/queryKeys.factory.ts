// main/src/application/http/queryKeys.factory.ts
// SSOT query keys — all query keys in one place.
// Convention: [domain, entity?, params?]
// Parameters MUST be typed from DTO — not `unknown`.
// Domain prefixes from queryDomains.config.ts (SSOT).

import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import type { PUBLIC_DTO_API_V1 } from '@kernel/models/public/public.dto';
import type { MODERATION_DTO_API_V1 } from '@kernel/models/moderation/moderation.dto';
import type { EventLogType } from '@kernel/models/db_models.generated.dto';
import { QD } from './queryDomains.config';

// --- Typed filter params from DTOs ---
type ExploreFilters = GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['REQUEST'];
type GalleryFilters = GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['REQUEST'];
type AdminUserFilters =
  ADMIN_DTO_API_V1['ADMIN_GET_USERS_PAGINATED']['REQUEST'];
type AdminReportParams = ADMIN_DTO_API_V1['ADMIN_GET_REPORTS']['REQUEST'];
type AdminAiCrawlerListParams =
  ADMIN_DTO_API_V1['ADMIN_AI_CRAWLER_LIST']['REQUEST'];
type AdminUserTimelineParams =
  ADMIN_DTO_API_V1['ADMIN_GET_USER_TIMELINE']['REQUEST'];
type AuditTrailParams = ADMIN_DTO_API_V1['ADMIN_GET_AUDIT_TRAIL']['REQUEST'];
type AdminLogsScope = ADMIN_DTO_API_V1['GET_LOGS']['REQUEST'];
type AdminLogGroupsScope = ADMIN_DTO_API_V1['ADMIN_GET_LOG_GROUPS']['REQUEST'];
type ModerationReportsParams =
  MODERATION_DTO_API_V1['ADMIN_GET_CONTENT_REPORTS']['REQUEST'];
type StylistsListFilters = Pick<
  NonNullable<PUBLIC_DTO_API_V1['GET_PUBLIC_STYLISTS_LIST']['REQUEST']>,
  'city' | 'searchQuery'
>;

export const queryKeys = {
  // --- Account / User ---
  account: {
    billingProfile: [QD.ACCOUNT, 'billing-profile'] as const,
    planChangePreview: (
      params: ACCOUNT_DTO_API_V1['ACCOUNT_PLAN_CHANGE_PREVIEW']['REQUEST']
    ) => [QD.ACCOUNT, 'plan-change-preview', params] as const,
    current: [QD.ACCOUNT, 'current'] as const,
    profile: (identifier: string) =>
      [QD.ACCOUNT, 'profile', identifier] as const,
    // Prefix-only key for bulk invalidation across any profile identifier
    // (a stylist is reachable under user id AND vanity URL — both may be cached).
    // Used by invalidate-stylist-profile.helper after profile mutations.
    profileAll: [QD.ACCOUNT, 'profile'] as const,
    paymentStatus: [QD.ACCOUNT, 'paymentStatus'] as const,
    stylistsWithLocation: [QD.ACCOUNT, 'stylistsWithLocation'] as const,
    recoveryStatus: [QD.ACCOUNT, 'recoveryStatus'] as const,
    state: [QD.ACCOUNT, 'state'] as const,
    dashboardFeed: [QD.ACCOUNT, 'dashboardFeed'] as const,
    dashboardNote: [QD.ACCOUNT, 'dashboardNote'] as const,
    /** The stylist's notes hub; `null` = every client. */
    privateNotes: (clientUserId: string | null) =>
      [QD.ACCOUNT, 'privateNotes', clientUserId ?? 'all'] as const,
    privateNotesAll: [QD.ACCOUNT, 'privateNotes'] as const,
    usageStats: [QD.ACCOUNT, 'usageStats'] as const,
  },

  // --- Gallery ---
  gallery: {
    all: [QD.GALLERY] as const,
    records: (filters: GalleryFilters) =>
      [QD.GALLERY, 'records', filters] as const,
    explore: (filters: ExploreFilters) =>
      [QD.GALLERY, 'explore', filters] as const,
    byId: (id: string) => [QD.GALLERY, 'detail', id] as const,
    byAccount: (accountId: string) =>
      [QD.GALLERY, 'byAccount', accountId] as const,
    byAccountPaired: (accountId: string) =>
      [QD.GALLERY, 'byAccountPaired', accountId] as const,
    // Own visible pinned works in public-profile order (pin manager).
    pinned: [QD.GALLERY, 'pinned'] as const,
    colors: [QD.GALLERY, 'colors'] as const,
    traits: [QD.GALLERY, 'traits'] as const,
  },

  // --- Pairing ---
  pairing: {
    all: [QD.PAIRING] as const,
    session: [QD.PAIRING, 'session'] as const,
    pairs: [QD.PAIRING, 'pairs'] as const,
    accessStatus: (stylistAccountId: string) =>
      [QD.PAIRING, 'accessStatus', stylistAccountId] as const,
    // Stały kod QR (2026-07-11): prośby PENDING na ekranie Parowanie.
    pendingRequests: [QD.PAIRING, 'pendingRequests'] as const,
    myPendingRequests: [QD.PAIRING, 'myPendingRequests'] as const,
  },

  messaging: {
    // D2: dwie listy pod osobnymi kluczami — domyślna (hidden=false; z niej liczy
    // się badge nieprzeczytanych) i „Pokaż ukryte" (hidden=true). Statyczny
    // wspólny klucz nadpisywałby cache badge'a listą ukrytych.
    conversationsAll: [QD.MESSAGING, 'conversations'] as const,
    conversations: (hidden: boolean) =>
      [QD.MESSAGING, 'conversations', hidden ? 'hidden' : 'visible'] as const,
    thread: (pairId: string) => [QD.MESSAGING, 'thread', pairId] as const,
  },

  // --- Bookmark (from favorite.dto — bookmark stylists) ---
  bookmark: {
    all: [QD.BOOKMARK] as const,
    stylists: [QD.BOOKMARK, 'stylists'] as const,
  },

  // --- Favorite (gallery records) ---
  favorite: {
    all: [QD.FAVORITE] as const,
    records: [QD.FAVORITE, 'records'] as const,
    grouped: [QD.FAVORITE, 'grouped'] as const,
  },

  // --- Staff (salon staff) ---
  staff: {
    all: [QD.STAFF] as const,
    members: [QD.STAFF, 'members'] as const,
    byId: (staffId: string) => [QD.STAFF, 'member', staffId] as const,
    /** Invitee side: the caller's own pending salon-team invitations. */
    myInvitations: [QD.STAFF, 'my-invitations'] as const,
    myTeam: [QD.STAFF, 'my-team'] as const,
  },

  // --- Salon profile and salon gallery ---
  salon: {
    /** The owner's own salon profile (management read). */
    mine: [QD.SALON, 'mine'] as const,
    /** The member's own „show my works in salons” switch. */
    visibility: [QD.SALON, 'visibility'] as const,
    slugAvailability: (slug: string) => [QD.SALON, 'slug', slug] as const,
    publicProfile: (identifier: string, bySlug: boolean) =>
      [QD.SALON, 'public', identifier, bySlug] as const,
    /** The salon a stylist belongs to, for her gallery's salon switch. */
    ofStylist: (stylistId: string) =>
      [QD.SALON, 'of-stylist', stylistId] as const,
    gallery: (
      salonAccountId: string,
      publicOnly: boolean,
      stylistAccountId: string,
      take: number | undefined
    ) =>
      [
        QD.SALON,
        'gallery',
        salonAccountId,
        publicOnly,
        stylistAccountId,
        take,
      ] as const,
  },

  // --- Blog (DTOs not yet in shared-kernel — keys reserved for future use) ---
  blog: {
    all: [QD.BLOG] as const,
    posts: [QD.BLOG, 'posts'] as const,
    post: (slug: string) => [QD.BLOG, 'post', slug] as const,
    categories: [QD.BLOG, 'categories'] as const,
  },

  // --- Admin ---
  admin: {
    metrics: [QD.ADMIN, 'metrics'] as const,
    dashboard: [QD.ADMIN, 'dashboard'] as const,
    health: [QD.ADMIN, 'health'] as const,
    attention: [QD.ADMIN, 'attention'] as const,
    users: (filters: AdminUserFilters) => [QD.ADMIN, 'users', filters] as const,
    // Prefix-only key for bulk invalidation across any user filter/page combination.
    usersAll: [QD.ADMIN, 'users'] as const,
    featureFlags: [QD.ADMIN, 'feature-flags'] as const,
    config: [QD.ADMIN, 'config'] as const,
    reports: (params: AdminReportParams) =>
      [QD.ADMIN, 'reports', params] as const,
    logs: (scope: AdminLogsScope) => [QD.ADMIN, 'logs', scope] as const,
    // Prefix-only key for bulk invalidation across any log filter combination.
    logsAll: [QD.ADMIN, 'logs'] as const,
    logGroups: (scope: AdminLogGroupsScope) =>
      [QD.ADMIN, 'logGroups', scope] as const,
    logGroupsAll: [QD.ADMIN, 'logGroups'] as const,
    logDetails: (id: number) => [QD.ADMIN, 'logDetails', id] as const,
    logDetailsAll: [QD.ADMIN, 'logDetails'] as const,
    permissions: [QD.ADMIN, 'permissions'] as const,
    announcements: [QD.ADMIN, 'announcements'] as const,
    auditTrail: (params: AuditTrailParams) =>
      [QD.ADMIN, 'auditTrail', params] as const,
    // Prefix-only key for bulk invalidation across any audit-trail filter/page.
    auditTrailAll: [QD.ADMIN, 'auditTrail'] as const,
    aiCrawlerStats: [QD.ADMIN, 'aiCrawlerStats'] as const,
    aiCrawlerList: (params: AdminAiCrawlerListParams) =>
      [QD.ADMIN, 'aiCrawlerList', params] as const,
    notes: [QD.ADMIN, 'notes'] as const,
    policies: [QD.ADMIN, 'policies'] as const,
    // Admin has no cache keys of its own for colors/traits: it uses the shared
    // queryKeys.gallery.colors/traits (same endpoint /api/v1/gallery/colors|traits).
    emailHistory: (userId: string) =>
      [QD.ADMIN, 'emailHistory', userId] as const,
    userTimeline: (params: AdminUserTimelineParams) =>
      [QD.ADMIN, 'userTimeline', params] as const,
    emailSchedule: [QD.ADMIN, 'emailSchedule'] as const,
    emailPipeline: [QD.ADMIN, 'emailPipeline'] as const,
    emailPreview: (templateId: string, locale: string) =>
      [QD.ADMIN, 'emailPreview', templateId, locale] as const,
    contentReports: (params: ModerationReportsParams) =>
      [QD.ADMIN, 'contentReports', params] as const,
    // Prefix-only key for bulk invalidation across any filter/page combination
    contentReportsAll: [QD.ADMIN, 'contentReports'] as const,
  },

  // --- Pricing ---
  pricing: {
    plans: [QD.PRICING, 'plans'] as const,
    market: [QD.PRICING, 'market'] as const,
    plansInCurrency: (currency: string) =>
      [QD.PRICING, 'plans', currency] as const,
  },

  // --- Client ---
  client: {
    all: [QD.CLIENT] as const,
    profile: [QD.CLIENT, 'profile'] as const,
    contactForStylist: (clientUserId: string) =>
      [QD.CLIENT, 'contactForStylist', clientUserId] as const,
    crmNote: (clientUserId: string) =>
      [QD.CLIENT, 'crmNote', clientUserId] as const,
    importantNote: (clientUserId: string) =>
      [QD.CLIENT, 'importantNote', clientUserId] as const,
    visits: (clientUserId: string) =>
      [QD.CLIENT, 'visits', clientUserId] as const,
  },

  // --- Session Container ---
  // DECISION: backend GET /session-container/get-my scopes results by accountType
  // (client_account_id vs stylist_account_id), so a dual-role user has TWO independent result sets.
  // One shared 'my' key collided in the cache between useClientSessions (client view) and
  // useSharedSessions (stylist view); the keys differ by a role discriminator. Invalidations use
  // queryKeys.sessionContainer.all (prefix), so 'my' and 'myAsStylist' fall together.
  sessionContainer: {
    all: [QD.SESSION_CONTAINER] as const,
    my: [QD.SESSION_CONTAINER, 'my'] as const,
    myAsStylist: [QD.SESSION_CONTAINER, 'my', 'stylist'] as const,
    byId: (id: string) => [QD.SESSION_CONTAINER, 'detail', id] as const,
    // DECISION: client-card visit-inspiration photos use a SEPARATE key, NOT byId. byId stores the
    // unwrapped SessionContainerDetailDTO (see the DECISION in useSessionDetail/useClientSessionDetail);
    // the client-card hook projects to a string[] of photo URLs and opts into silentBusinessError.
    // Sharing byId would re-introduce the cache-shape collision (string[] vs DTO under one key) and
    // make silentBusinessError non-deterministic (the flag lives in the queryFn, so observers
    // sharing a key would race suppression). Still under `all` for invalidation.
    byIdVisitPhotos: (id: string) =>
      [QD.SESSION_CONTAINER, 'detail', id, 'visit-photos'] as const,
    insights: [QD.SESSION_CONTAINER, 'insights'] as const,
  },

  // --- Public ---
  public: {
    stylistsList: (filters: StylistsListFilters) =>
      [QD.PUBLIC, 'stylistsList', filters] as const,
    // DD3-F6: prefix-only key for bulk invalidation across any city/searchQuery filter.
    // Used by invalidate-stylist-profile.helper after profile mutations (location, name,
    // vanity URL, social links) so explore page reflects the latest data on next visit.
    stylistsListAll: [QD.PUBLIC, 'stylistsList'] as const,
    featureFlags: [QD.PUBLIC, 'featureFlags'] as const,
    activeAnnouncements: [QD.PUBLIC, 'activeAnnouncements'] as const,
    maintenanceMessage: [QD.PUBLIC, 'maintenanceMessage'] as const,
  },

  // --- Session (device sessions) ---
  session: {
    all: [QD.SESSION, 'all'] as const,
  },

  // --- Event Log ---
  eventLog: {
    byType: (type: EventLogType) => [QD.EVENT_LOG, 'byType', type] as const,
  },

  // --- Support ---
  support: {
    threads: [QD.SUPPORT, 'threads'] as const,
    threadMessages: (threadId: string) =>
      [QD.SUPPORT, 'threadMessages', threadId] as const,
    // Threads with a support reply the owner has not opened (drawer badge, hub).
    unreadCount: [QD.SUPPORT, 'unreadCount'] as const,
    adminThreads: (status?: string) =>
      [QD.SUPPORT, 'adminThreads', status] as const,
    // Prefix-only key for bulk invalidation across any status filter combination.
    adminThreadsAll: [QD.SUPPORT, 'adminThreads'] as const,
    adminThreadMessages: (threadId: string) =>
      [QD.SUPPORT, 'adminThreadMessages', threadId] as const,
  },

  // --- Notifications (centre + bell) ---
  notifications: {
    /** Prefix for invalidation after any mutation that creates or closes a row. */
    all: [QD.NOTIFICATIONS] as const,
    /** The bell's badge, polled. */
    unreadCount: [QD.NOTIFICATIONS, 'unreadCount'] as const,
    /** The list on /app/notifications. */
    recent: [QD.NOTIFICATIONS, 'recent'] as const,
  },
} as const;
