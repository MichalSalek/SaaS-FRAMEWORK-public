import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { AdminUsersAttentionFilter } from '../../domain/admin/admin-attention.config';
import type { PricingPlan } from '../../domain/pricing/pricing.config';
import type {
  AccountStatus,
  AccountType,
  PaymentStatus,
  StylistAccount,
  User,
} from '../db_models.generated.dto';
import type { SystemRoleIdType } from '../db_models.manual.dto';
import type { SafeCurrentUser } from '../session/session.dto';

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

// --- Users API ---

type BecomeUserRequest = Pick<User, 'id'>;

type DisableAnyRequest = Pick<User, 'id'>;

type EnableAnyRequest = Pick<User, 'id'>;

type DeleteAnyRequest = Pick<User, 'id'>;

// DeletedUser PK is user_id (String @id) — purge targets the ARCHIVE row, NOT a live User.
type PurgeDeletedUserRequest = { user_id: string };

type ChangePricingPlanRequest = Pick<User, 'id'> & {
  pricing_plan: PricingPlan;
};

type AdminGetUsersPaginatedRequest = {
  cursor?: string;
  take?: number;
  search?: string;
  // DECISION (nie usuwaj tego komentarza):
  // `role` carries an AccountType ('STYLIST' | 'CLIENT'), nie SystemRoleId.
  // UI (UsersFilterBar) operuje na AccountType (jeden enum = jeden filter dropdown).
  // Backend operation (admin-user-search.operations.ts) konwertuje AccountType
  // → SystemRoleId via `ACCOUNT_TYPE_TO_ROLE_ID` mapping przed Prisma where.role_id.
  // Anti-pattern (przed fixem): `role?: string` + `where.role_id = String(params.role)`
  // → silent filter mismatch (UI sends 'STYLIST', DB row.role_id = 'role_stylist').
  role?: AccountType;
  // Users who have neither a stylist nor a client account yet (never picked a
  // role). Their account_type is only the CLIENT signup default (S122).
  onboarding_pending?: boolean;
  // "Needs a reaction" lists behind the admin menu badges `payments_attention`
  // and `stuck_accounts` (thresholds: ADMIN_ATTENTION). AND-ed with every
  // other filter; the predicates are shared with the counters (web-1
  // admin-user-attention.predicates.ts), so the list equals the badge.
  attention?: AdminUsersAttentionFilter;
  is_active?: boolean;
  account_status?: AccountStatus;
  payment_status?: PaymentStatus;
  pricing_plan?: PricingPlan;
  sort_by?: 'id' | 'email' | 'name' | 'created_at';
  sort_order?: 'asc' | 'desc';
};

// DECISION (nie usuwaj tego komentarza):
// AdminGetUsersPaginated RESPONSE.records to JAWNA PROJEKCJA, nie pełny
// UserWithRelationsExtended. Resolver (admin-user-search.operations.ts)
// Prisma-selektuje ścisły podzbiór pól; wcześniej "praprał" typ przez
// `narrowUser<UserWithRelationsExtended>(u) as unknown as T` — każde
// NIEselektowane pole było zadeklarowane jako required, a w runtime undefined.
// Realny skutek: admin UI czytał `stylist_account.trial_ends_at` (nigdy nie
// selektowany → zawsze undefined), więc KAŻDA stylistka w triallu była
// etykietowana "Active" (getStatusInfo w UsersTable.parts). Kontrakt = dokładnie
// pola, które admin UI konsumuje, UNION (trial_started_at, trial_ends_at)
// wymagane przez logikę statusu. Dodajesz nowe pole w admin UI → dopisz je TU
// i do `userSelect` w admin-user-search.operations.ts (SSOT projekcji ↔ select).
type AdminUserListStylistAccount = Pick<
  StylistAccount,
  | 'pricing_plan'
  | 'payment_status'
  | 'account_status'
  | 'trial_started_at'
  | 'trial_ends_at'
>;

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
> & {
  stylist_account: AdminUserListStylistAccount | null;
  // True once the user created a stylist OR a client account. `account_type`
  // defaults to CLIENT at signup, so without this flag a person who never
  // picked a role reads as "Klientka" in the admin list (S122).
  onboarding_completed: boolean;
  // Sessions as Prisma _count (avoids N+1 over-fetch of session rows).
  _count: { sessions: number };
};

type AdminGetUsersPaginatedResponse = {
  records: AdminUserListRecord[];
  nextCursor: string | null;
};

type AdminGetMetricsResponse = {
  users: {
    total: number;
    active: number;
    disabled: number;
    newToday: number;
    newThisWeek: number;
    newThisMonth: number;
    byRole: {
      role_id: SystemRoleIdType;
      role_name: string;
      count: number;
    }[];
    byPlan: { plan: PricingPlan; count: number }[];
    byAccountType: { type: AccountType; count: number }[];
  };
  sessions: {
    activeSessions: number;
  };
  gallery: {
    totalRecords: number;
  };
  recentRegistrations: {
    id: string;
    email: string;
    name: string;
    created_at: string;
    role_id: SystemRoleIdType;
  }[];
  // DECISION (nie usuwaj tego komentarza):
  // Conversion funnel metrics — baseline pre-launch dla post-launch optimization.
  // Trial-requires-card gate (DOMAIN_SSOT §8.2) MUSI mieć baseline conversion rate
  // przed marketing scale-up. Industry: 60-80% card-required trials never convert.
  // Cache 5 min — admin dashboard polling, aggregates costly na FK joins.
  // Post-launch: cohort analysis per acquisition channel (deferred do MAIL/analytics).
  conversion_funnel: {
    /** Total StylistAccount rows — every signup that created an account. */
    signup_count: number;
    /** Accounts with trial_started_at IS NOT NULL — trial gate entered. */
    trial_started_count: number;
    /** Trial accounts that converted (trial_started_at IS NOT NULL AND payment_status = 'PAID'). */
    trial_to_paid_count: number;
    /** Trial accounts where trial expired without payment (trial_ends_at < now AND payment_status != 'PAID'). */
    trial_expired_count: number;
    /** payment_status = 'PAID' AND account_status = 'ACTIVE'. */
    paid_active_count: number;
    /** trial_to_paid_count / trial_started_count * 100, rounded to 1 decimal. 0 when trial_started_count = 0. */
    conversion_rate_pct: number;
    /** Accounts that became CANCELLED (account_status NOT_ACTIVE via Stripe cancel) in last 30 days
     *  expressed as pct of paid_active_count. 0 when paid_active_count = 0. */
    churn_rate_30d_pct: number;
  };
};

export type AdminUsersDtoApi = {
  /** Admin rozpoczyna impersonację: tworzy sesję wskazanego usera (po id) i zwraca jego bezpieczny profil. */
  BECOME_USER: {
    REQUEST: BecomeUserRequest;
    RESPONSE: SafeCurrentUser;
    RESPONSE_ERROR: undefined;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      BecomeUserRequest,
      SafeCurrentUser,
      undefined
    >;
  };

  /** Admin kończy impersonację i wraca do własnej sesji, zwraca swój bezpieczny profil. */
  SWITCH_BACK_BECOME_USER: {
    REQUEST: undefined;
    RESPONSE: SafeCurrentUser;
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      SafeCurrentUser,
      DetailedErrorPayload<undefined>
    >;
  };

  /** Odświeża trwającą impersonację admina, przedłuża sesję i zwraca nowy czas wygaśnięcia (expiresAt). */
  REFRESH_IMPERSONATION: {
    REQUEST: undefined;
    RESPONSE: { expiresAt: number };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      { expiresAt: number },
      DetailedErrorPayload<undefined>
    >;
  };

  /** Admin wyłącza konto dowolnego usera (po id), ustawiając disabled_at (idempotentne). */
  USER_DISABLE_ANY: {
    REQUEST: DisableAnyRequest;
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<DisableAnyRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      DisableAnyRequest,
      undefined,
      DetailedErrorPayload<DisableAnyRequest>
    >;
  };

  /** Admin ponownie włącza konto dowolnego usera (po id), zdejmując disabled_at. */
  USER_ENABLE_ANY: {
    REQUEST: EnableAnyRequest;
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<EnableAnyRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      EnableAnyRequest,
      undefined,
      DetailedErrorPayload<EnableAnyRequest>
    >;
  };

  /** Admin usuwa konto dowolnego usera (po id): przenosi je do archiwum DeletedUser i oznacza GDPR erasure. */
  USER_DELETE_ANY: {
    REQUEST: DeleteAnyRequest;
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<DeleteAnyRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      DeleteAnyRequest,
      undefined,
      DetailedErrorPayload<DeleteAnyRequest>
    >;
  };

  /** Admin (MASTER_ADMIN) fizycznie kasuje wiersz archiwum DeletedUser po user_id (GDPR Art.17). */
  ADMIN_PURGE_DELETED_USER: {
    REQUEST: PurgeDeletedUserRequest;
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<PurgeDeletedUserRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      PurgeDeletedUserRequest,
      undefined,
      DetailedErrorPayload<PurgeDeletedUserRequest>
    >;
  };

  /** Admin zmienia plan cenowy (pricing_plan) wskazanego usera po id. */
  ADMIN_CHANGE_PRICING_PLAN: {
    REQUEST: ChangePricingPlanRequest;
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<ChangePricingPlanRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      ChangePricingPlanRequest,
      undefined,
      DetailedErrorPayload<ChangePricingPlanRequest>
    >;
  };

  /** Zwraca stronicowaną kursorem listę userów z filtrami (search, rola, status konta, plan) i sortowaniem. */
  ADMIN_GET_USERS_PAGINATED: {
    REQUEST: AdminGetUsersPaginatedRequest;
    RESPONSE: AdminGetUsersPaginatedResponse;
    RESPONSE_ERROR: DetailedErrorPayload<AdminGetUsersPaginatedRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      AdminGetUsersPaginatedRequest,
      AdminGetUsersPaginatedResponse,
      DetailedErrorPayload<AdminGetUsersPaginatedRequest>
    >;
  };

  /** Masowo wyłącza konta userów z listy user_ids, zwraca wynik zbiorczy (affected, skipped, errors). */
  ADMIN_BULK_DISABLE: {
    REQUEST: { user_ids: string[] };
    RESPONSE: BulkActionResult;
    RESPONSE_ERROR: DetailedErrorPayload<{ user_ids: string }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      { user_ids: string[] },
      BulkActionResult,
      DetailedErrorPayload<{ user_ids: string }>
    >;
  };

  /** Masowo włącza konta userów z listy user_ids, zwraca wynik zbiorczy (affected, skipped, errors). */
  ADMIN_BULK_ENABLE: {
    REQUEST: { user_ids: string[] };
    RESPONSE: BulkActionResult;
    RESPONSE_ERROR: DetailedErrorPayload<{ user_ids: string }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      { user_ids: string[] },
      BulkActionResult,
      DetailedErrorPayload<{ user_ids: string }>
    >;
  };

  /** Masowo zmienia plan cenowy (pricing_plan) userów z listy user_ids, zwraca wynik zbiorczy. */
  ADMIN_BULK_CHANGE_PLAN: {
    REQUEST: { user_ids: string[]; pricing_plan: PricingPlan };
    RESPONSE: BulkActionResult;
    RESPONSE_ERROR: DetailedErrorPayload<{
      user_ids: string;
      pricing_plan: string;
    }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      { user_ids: string[]; pricing_plan: PricingPlan },
      BulkActionResult,
      DetailedErrorPayload<{ user_ids: string; pricing_plan: string }>
    >;
  };

  /** Masowo wylogowuje userów z listy user_ids: kasuje ich sesje i zwraca liczbę usuniętych sesji. */
  ADMIN_BULK_LOGOUT: {
    REQUEST: { user_ids: string[] };
    RESPONSE: BulkLogoutResult;
    RESPONSE_ERROR: DetailedErrorPayload<{ user_ids: string }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      { user_ids: string[] },
      BulkLogoutResult,
      DetailedErrorPayload<{ user_ids: string }>
    >;
  };

  /** Zwraca metryki panelu admina: userzy, sesje, galeria, ostatnie rejestracje i lejek konwersji. */
  ADMIN_GET_METRICS: {
    REQUEST: undefined;
    RESPONSE: AdminGetMetricsResponse;
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      AdminGetMetricsResponse,
      DetailedErrorPayload<undefined>
    >;
  };
};
