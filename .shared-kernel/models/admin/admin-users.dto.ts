import type { StylistAccount, User } from '../db_models.generated.dto';

// --- Bulk Action Result Types ---

export type BulkActionResult = {
  affected: number;
  skipped: number;
  errors: { user_id: string; reason: string }[];
};

export type BulkLogoutResult = {
  affected: number;
  sessionsDeleted: number;
};

// DECISION: AdminGetUsersPaginated RESPONSE.records is an EXPLICIT PROJECTION, not the full
// UserWithRelationsExtended. The resolver (admin-user-search.operations.ts) Prisma-selects a strict
// subset; it used to launder the type with `narrowUser<UserWithRelationsExtended>(u) as unknown as T`,
// so every unselected field was declared required but undefined at runtime. Real effect: the admin UI
// read `stylist_account.trial_ends_at` (never selected), so every trialing stylist showed "Active"
// (getStatusInfo in UsersTable.parts). The contract is exactly the fields the admin UI consumes plus
// (trial_started_at, trial_ends_at) for the status logic. A new field in the admin UI goes here AND
// into `userSelect` in admin-user-search.operations.ts.
type AdminUserListStylistAccount = Pick<
  StylistAccount,
  | 'pricing_plan'
  | 'payment_status'
  | 'account_status'
  | 'trial_started_at'
  | 'trial_ends_at'
>;

// Salon team position: OWNER = her stylist account has at least one accepted,
// active team member; MEMBER = she is an accepted, active member of another
// account's team. An owner is never a StaffMember row of her own salon.
export type AdminUserTeamRole = 'OWNER' | 'MEMBER';

// DECISION: per-row figures for analysis on the admin users list, computed for the PAGE's ids with a
// fixed number of batched groupBy/findMany queries (never per row; admin-user-search.operations.ts).
// Chosen because each is one indexed lookup per page: works and public works (GalleryRecord by
// account), ACTIVE connections on either side of ClientStylistPair, Inspiration Sessions on either
// side, messages she sent, support threads, push devices that still deliver, city, team role and the
// two mail consents. Left out on purpose: likes and profile views (cached counters exist but say
// little per person) and revenue (Stripe is the source, not this list). `null` = the figure belongs
// to a stylist account she does not have, never "zero".
export type AdminUserListStats = {
  /** Every work in her gallery, hidden ones included (same count `sort_by=photos` orders by). */
  photos: number | null;
  /** Pinned and visible works: what her public profile shows. */
  public_works: number | null;
  /** ACTIVE pairs: her clients as a stylist plus her stylists as a client. */
  connections: number;
  /** Inspiration Sessions she created as a client or received as a stylist. */
  inspiration_sessions: number;
  /** Messages she sent in any pair, from either side. */
  messages_sent: number;
  support_threads: number;
  /** Registered push devices whose last send did not fail. */
  push_devices: number;
  city: string | null;
  team_role: AdminUserTeamRole | null;
  /** `users.notifications_enabled`: activity mail and push. */
  notifications_enabled: boolean;
  /** `StylistAccount.email_marketing`; null without a stylist account. */
  email_marketing: boolean | null;
};

export type AdminUserListRecord = Pick<
  User,
  | 'id'
  | 'email'
  | 'emailVerified'
  | 'name'
  | 'account_type'
  | 'role_id'
  | 'is_active'
  | 'createdAt'
  | 'updatedAt'
  | 'last_login_at'
> & {
  stats: AdminUserListStats;
  stylist_account: AdminUserListStylistAccount | null;
  // True once the user created a stylist OR a client account. `account_type`
  // defaults to CLIENT at signup, so without this flag a person who never
  // picked a role reads as "Klientka" in the admin list.
  onboarding_completed: boolean;
  // Sessions as Prisma _count (avoids N+1 over-fetch of session rows).
  _count: { sessions: number };
};
