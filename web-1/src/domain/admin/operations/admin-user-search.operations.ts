import { DB_CLIENT } from '@app/db/db.client';
import { escapeLikePattern } from '@app/db/like-escape';
import { reportIssueBackend } from '@app/debugger/error-handler';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import {
  assertType,
  isSystemRoleIdNarrower,
} from '@kernel/models/type_narrowing';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { Prisma } from '../../../prisma/js-client';
import { buildUserAttentionWhere } from './admin-user-attention.predicates';
import { ACCOUNT_TYPE_TO_ROLE_ID } from '@kernel/models/db_models.manual.dto';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';

// DECISION (nie usuwaj tego komentarza):
// UI (UsersFilterBar) operuje na AccountType ('STYLIST' | 'CLIENT') — single enum
// = single filter dropdown. Backend MUSI skonwertować na SystemRoleId
// ('role_stylist' | 'role_client') przed Prisma where.role_id. Przed fixem:
// `where.role_id = String(params.role)` → silent filter mismatch (DB row ma
// 'role_stylist', UI wysyła 'STYLIST', match = 0 rows).
// DD-H2 (Fix Wave A): mapping ACCOUNT_TYPE_TO_ROLE_ID przeniesiony do kernel
// (`db_models.manual.dto.ts`) jako SSOT — wczesniej duplikat tutaj + w
// user-onboarding.operations.ts.

type PaginatedUsersRequest =
  ADMIN_DTO_API_V1['ADMIN_GET_USERS_PAGINATED']['REQUEST'];
type PaginatedUsersResponse =
  ADMIN_DTO_API_V1['ADMIN_GET_USERS_PAGINATED']['RESPONSE'];
type AdminUserListRecord = PaginatedUsersResponse['records'][number];

type AdminUserSearchError = AdminInsufficientPermissionsError | DatabaseError;

type ActiveSessionCountRow = { user_id: string; active_sessions: number };

/**
 * Liczba AKTYWNYCH sesji (expires w przyszłości) dla userów Z BIEŻĄCEJ STRONY.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Wcześniej było to `_count: { select: { sessions: { where: ... } } }` w findMany. Relacyjny
 * `_count` w Prismie kompiluje się do OSOBNEGO, NIESKORELOWANEGO agregatu po CAŁEJ tabeli
 * "Session" (GROUP BY user_id bez zawężenia do id ze strony) — na koncie z setkami tysięcy
 * sesji admin płacił pełny skan tabeli za 50 liczb. LATERAL skorelowany z id strony schodzi
 * na index-seek [userId, expires]. `NOW() AT TIME ZONE 'UTC'` (a nie bind-param z JS `Date`):
 * kolumna `expires` to `timestamp without time zone` trzymany w UTC, a surowy parametr Date
 * node-pg serializuje z offsetem lokalnej strefy procesu — na serwerze w innej strefie próg
 * przesuwałby się o godziny (zweryfikowane na dev-DB: rozjazd 2 h vs ścieżka ORM).
 * Brak wiersza dla usera = 0 sesji (LATERAL zwraca 0, mapowanie i tak ma fallback).
 */
const fetchActiveSessionCounts = async (
  userIds: readonly string[]
): Promise<Map<string, number>> => {
  if (userIds.length === 0) {
    return new Map();
  }

  const rows = await DB_CLIENT.use.$queryRaw<ActiveSessionCountRow[]>(
    Prisma.sql`
      SELECT
        u."id" AS user_id,
        active."active_sessions" AS active_sessions
      FROM "users" u
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::int AS active_sessions
        FROM "Session" s
        WHERE s."user_id" = u."id"
          AND s."expires" > (NOW() AT TIME ZONE 'UTC')
      ) active
      WHERE u."id" IN (${Prisma.join([...userIds])})
    `
  );

  return new Map(rows.map(row => [row.user_id, row.active_sessions] as const));
};

/**
 * Admin paginated user search with filters and sorting.
 */
export const adminGetUsersPaginated_IO = async ({
  currentUser,
  params,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
  params: PaginatedUsersRequest;
}): Promise<OperationResult<PaginatedUsersResponse, AdminUserSearchError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    const take = Math.min(100, Math.max(1, Number(params.take) || 50));
    const cursor = params.cursor || undefined;

    // DECISION (nie usuwaj tego komentarza):
    // NIE stosujemy tu `isValidCursorFormat` (cuid format-gate z gallery-explore.query.ts),
    // mimo że pozostałe listy cursor-paginated go mają. Powód odkryty pomiarem (2026-06-15):
    // ten kursor kotwiczy po User.id, a User.id NIE jest jednorodnie cuid — Better Auth
    // mintuje własne id przy sign-up/seed i NADPISUJE Prisma `@default(cuid())` (admin/seed
    // users dostają prefiks `usr_…`, np. `usr_30dg2khlk7xc9nwn`). Realny server-issued
    // nextCursor wskazujący na takiego usera NIE pasuje do `^[a-z0-9]{20,40}$` (underscore),
    // więc format-gate ZWRACAŁBY false 400 na legalnej paginacji adminów → regresja.
    // null-byte (\0) 500-wektor jest zamykany globalnie przez null-byte guard (handler layer),
    // więc gate cuid nie jest tu potrzebny i byłby szkodliwy. Stale-ale-poprawny cursor →
    // 200-pusta strona (akceptowalne; FE odtwarza tylko server-issued cursory). Endpoint
    // admin-only (requireAdminPermission powyżej) — brak ekspozycji na nieufny input.

    // Build sort. DECISION (nie usuwaj tego komentarza):
    // API/DTO eksponuje snake_case sort-keys (id|email|name|created_at), ale pola
    // Prisma NIE są wszystkie snake_case — kolumna znacznika czasu to `createdAt`
    // (camelCase). Wstrzykiwanie surowego klucza API do orderBy sprawiało, że
    // `sort_by=created_at` (DOMYŚLNY sort z frontu) generował `orderBy: { created_at }`
    // → "Unknown argument" → 500 na KAŻDYM domyślnym ładowaniu listy userów.
    // Mapujemy klucz API → faktyczne pole Prisma.
    const SORT_FIELD_MAP = {
      id: 'id',
      email: 'email',
      name: 'name',
      created_at: 'createdAt',
    } as const;
    type SortKey = keyof typeof SORT_FIELD_MAP;
    const sortKey: SortKey = (
      Object.keys(SORT_FIELD_MAP) as SortKey[]
    ).includes((params.sort_by ?? '') as SortKey)
      ? (params.sort_by as SortKey)
      : 'id';
    const sortField = SORT_FIELD_MAP[sortKey];
    const sortOrder = params.sort_order === 'asc' ? 'asc' : 'desc';

    // Build where clause with proper Prisma types
    const where: Prisma.UserWhereInput = {};

    if (params.search && params.search.trim().length > 0) {
      // Escape LIKE metacharacters so `%`/`_` match literally and a trailing `\` cannot 500.
      const searchTerm = escapeLikePattern(params.search.trim());
      // Dokładne `id` obok e-maila i nazwy: link „Pokaż użytkownika" z logu
      // (który zna tylko user_id) trafia wprost w jeden wiersz. Równość po
      // kluczu głównym, więc bez kosztu skanu.
      where.OR = [
        { email: { contains: searchTerm, mode: 'insensitive' } },
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { id: params.search.trim() },
      ];
    }

    if (params.role !== undefined && params.role !== null) {
      where.role_id = ACCOUNT_TYPE_TO_ROLE_ID[params.role];
      // role_client is also the signup default, so "Klientka" must mean a
      // finished client onboarding, the same rule as the row label
      // (onboarding_completed); people who never picked a role stay out.
      if (params.role === AccountTypeValue.CLIENT) {
        where.client_account = { isNot: null };
      }
    }

    if (params.onboarding_pending === true) {
      where.stylist_account = null;
      where.client_account = null;
    }

    // "Needs a reaction" lists behind the admin menu badges. The predicate is
    // the one the badge counts with (admin-user-attention.predicates.ts) and
    // goes into AND, so it narrows every other filter instead of overwriting
    // a key another filter set (both touch `stylist_account`).
    if (params.attention !== undefined) {
      where.AND = [buildUserAttentionWhere(params.attention, new Date())];
    }

    if (params.is_active !== undefined && params.is_active !== null) {
      where.is_active = params.is_active;
    }

    const stylistAccountFilter: Prisma.StylistAccountWhereInput = {};
    if (params.account_status) {
      stylistAccountFilter.account_status = params.account_status;
    }
    if (params.payment_status) {
      stylistAccountFilter.payment_status = params.payment_status;
    }
    if (params.pricing_plan) {
      stylistAccountFilter.pricing_plan = params.pricing_plan;
    }
    // A plan/status filter needs a stylist account, which "no role yet"
    // excludes by definition: with the pending filter on, those filters are
    // ignored instead of turning the list into a guaranteed empty result.
    if (
      Object.keys(stylistAccountFilter).length > 0 &&
      params.onboarding_pending !== true
    ) {
      where.stylist_account = stylistAccountFilter;
    }

    // DECISION (nie usuwaj tego komentarza):
    // userSelect = DOKŁADNIE pola projekcji AdminUserListRecord (SSOT po stronie
    // kernela: admin-users.dto.ts). NIE selektujemy nic ponad to, co admin UI
    // konsumuje — kontrakt na drucie jest UCZCIWY (żadne pole nie jest deklarowane
    // jako obecne, a runtime-undefined). `trial_started_at`/`trial_ends_at` MUSZĄ
    // tu być: bez nich getStatusInfo etykietował każdą stylistkę w triallu jako
    // "Active". Zmieniasz select → wyrównaj projekcję w admin-users.dto.ts (i vice
    // versa). Wcześniejsze `role`/`account_id`/`account_expiration_date`/
    // `upcoming_payment_date`/`client_account` usunięte — nieużywane przez UI.
    const userSelect = {
      id: true,
      email: true,
      emailVerified: true,
      name: true,
      account_type: true,
      role_id: true,
      is_active: true,
      createdAt: true,
      updatedAt: true,
      stylist_account: {
        select: {
          pricing_plan: true,
          payment_status: true,
          account_status: true,
          trial_started_at: true,
          trial_ends_at: true,
        },
      },
      client_account: { select: { client_account_id: true } },
      // `_count.sessions` NIE jest tu selektowany — liczba aktywnych sesji przychodzi
      // ze skorelowanego LATERAL-a poniżej (fetchActiveSessionCounts).
    } satisfies Prisma.UserSelect;

    const records = await DB_CLIENT.use.user.findMany({
      select: userSelect,
      where,
      // Cursor field (id) MUST be in orderBy for stable pagination. When sortBy is
      // email/name/created_at those columns are non-unique → cursor+skip would skip/dup
      // rows. Appending `id` as a deterministic tiebreaker keeps the cursor stable
      // regardless of sortBy (when sortBy === 'id' the second key is a harmless no-op).
      orderBy: [{ [sortField]: sortOrder }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = records.length > take;
    const items = hasMore ? records.slice(0, take) : records;

    const activeSessionsByUserId = await fetchActiveSessionCounts(
      items.map(row => row.id)
    );

    // DECISION (nie usuwaj tego komentarza):
    // Budujemy AdminUserListRecord HONESTLY z pól selektowanych powyżej — bez
    // dawnego `narrowUser<UserWithRelationsExtended>(u) as unknown as T`
    // (double-cast deklarował pełny model, a runtime dawał undefined → mislabel
    // triala). Jedyne pole wymagające narrowania to `role_id`: Prisma zwraca `string`,
    // kernel wymaga SystemRoleIdType — pojedynczy assertType przy join (DB gwarantuje
    // ważny role_id, endpoint admin-only). Reszta (enumy planu/statusu, daty=Date,
    // id=string) to identyczne literal-uniony / aliasy → assignable wprost.
    const usersCollection: AdminUserListRecord[] = items.map(row => ({
      id: row.id,
      email: row.email,
      emailVerified: row.emailVerified,
      name: row.name,
      account_type: row.account_type,
      role_id: assertType(
        row.role_id,
        isSystemRoleIdNarrower,
        'role_id in adminGetUsersPaginated'
      ),
      is_active: row.is_active,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      stylist_account: row.stylist_account
        ? {
            pricing_plan: row.stylist_account.pricing_plan,
            payment_status: row.stylist_account.payment_status,
            account_status: row.stylist_account.account_status,
            trial_started_at: row.stylist_account.trial_started_at,
            trial_ends_at: row.stylist_account.trial_ends_at,
          }
        : null,
      onboarding_completed:
        row.stylist_account !== null || row.client_account !== null,
      _count: { sessions: activeSessionsByUserId.get(row.id) ?? 0 },
    }));

    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    reportIssueBackend({
      namespace: 'adminGetUsersPaginated',
      message: `Fetched ${usersCollection.length} users (cursor: ${cursor ?? 'start'}, hasMore: ${hasMore})`,
      payload: { count: usersCollection.length, hasMore, cursor },
      mode: 'info',
    });

    return success({
      records: usersCollection,
      nextCursor,
    });
  } catch (error) {
    return databaseFailure('adminGetUsersPaginated', error);
  }
};
