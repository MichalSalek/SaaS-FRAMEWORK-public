import { resolvePersonAvatarUrl } from '@kernel/domain/user/avatar.policy';
import { getClientSalonGroups_IO } from '../salon-client-groups.operations';
import type { ClientSalonGroup } from '@kernel/models/pairing/pairing.dto';
import { DB_CLIENT } from '@app/db/db.client';
import {
  AccountStatusValue,
  PairingStatusValue,
} from '@kernel/models/db_models.generated.dto';
import {
  failure,
  type OperationResult,
  success,
} from '@kernel/application/result.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { isP2025 } from '@app/db/prisma-error';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';

type GetMyPairsItem =
  | {
      id: string;
      user_id: string;
      name: string;
      email: string;
      paired_at: Date;
      /** D1: konto klientki nieaktywne — tożsamość zamaskowana w tej operacji. */
      counterpart_inactive: boolean;
    }
  | {
      id: string;
      account_id: string;
      salon_origin_account_id?: string | null;
      display_name: string | null;
      business_name: string | null;
      address_city: string | null;
      avatar_url: string | null;
      paired_at: Date;
      /** D1: konto stylistki nieaktywne — tożsamość zamaskowana w tej operacji. */
      counterpart_inactive: boolean;
    };

/**
 * Get my pairs (stylist's clients OR client's stylists).
 * Cursor-paginated by ClientStylistPair.id (default 50, max 100).
 */
export const getMyPairs_IO = async ({
  current_user_id,
  current_stylist_account_id,
  cursor,
  take = 50,
}: {
  current_user_id: string;
  current_stylist_account_id?: string;
  cursor?: string;
  take?: number;
}): Promise<
  OperationResult<
    {
      pairs: GetMyPairsItem[];
      nextCursor: string | null;
      salons?: ClientSalonGroup[];
    },
    DatabaseError | ValidationError
  >
> => {
  const effectiveTake = Math.min(Math.max(take, 1), 100);

  // DECISION: uniform cursor contract (pattern of gallery-explore.query.ts). Both branches (stylist/client) anchor
  // on ClientStylistPair.id, so validation happens once, before the branch. (1) Format gate: a null byte or
  // non-cuid cursor would throw in Prisma as an unmapped 500; isValidCursorFormat (@kernel) returns
  // VALIDATION_ERROR 400. (2) Existence pre-check: findMany for a stale cursor returns an EMPTY set (no P2025),
  // so without it 200 + pairs:[] is indistinguishable from the end of the list. The pre-check is
  // OWNERSHIP-SCOPED (the caller's client_user_id / stylist_account_id, mirroring both branches below): a legit
  // cursor is always the caller's own row (it comes from the same list's nextCursor), so the scope never rejects
  // real pagination, and it closes the oracle (without it a foreign live pair id gave 200 and a missing one 400).
  // Same cost (findFirst by id+scope instead of findUnique by id). Unlike the sibling gallery-explore and
  // public-stylists, whose data is PUBLIC, ClientStylistPair is a PRIVATE relation, so the scope is due. The
  // P2025 branch in the catch below stays as a harmless fallback.
  if (cursor !== undefined) {
    if (!isValidCursorFormat(cursor)) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'cursor',
        message: 'Invalid cursor',
      });
    }
    try {
      const cursorRow = await DB_CLIENT.use.clientStylistPair.findFirst({
        where: {
          id: cursor,
          ...(current_stylist_account_id
            ? { stylist_account_id: current_stylist_account_id }
            : { client_user_id: current_user_id }),
        },
        select: { id: true },
      });
      if (!cursorRow) {
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'cursor',
          message: 'Invalid cursor',
        });
      }
    } catch (error) {
      return databaseFailure('getMyPairs:cursorCheck', error);
    }
  }

  try {
    if (current_stylist_account_id) {
      // Stylist: return paired clients (single query with relation include)
      // DECISION: a pair with a client whose account is inactive (is_active=false after self-soft-delete
      // DOMAIN_SSOT §13.1 or admin-disable; the pair stays ACTIVE) STILL counts toward the cap (ACTIVE_PAIR_FOR_CAP,
      // see pairing-cap.predicates.ts), so it IS listed, as "Konto nieaktywne" with the identity MASKED HERE on
      // the server (name/email = '') and `counterpart_inactive=true`. The earlier version FILTERED such rows: no PII
      // leaked, but the slot was invisible and could not be freed. The mask stays (mirror of the guard in
      // getClientContactForStylist, client-profile.operations.ts); only the invisibility is gone. Ids stay because
      // they drive "Zwolnij miejsce" (revoke-access). Clients have no account_status (a stylist flag): User.is_active
      // is the ONLY client liveness flag. No automatic reconciliation on account restore: a slot is freed only by the
      // explicit action or the terminal MOVE after 90 days (FK cascade).
      const pairs = await DB_CLIENT.use.clientStylistPair.findMany({
        where: {
          stylist_account_id: current_stylist_account_id,
          status: PairingStatusValue.ACTIVE,
        },
        include: {
          client_user: {
            select: { id: true, email: true, name: true, is_active: true },
          },
        },
        // Cursor field (id) must be part of orderBy for stable pagination — paired_at is
        // non-unique, so id is the tiebreaker preventing skip/dup on page boundaries.
        orderBy: [{ paired_at: 'desc' }, { id: 'desc' }],
        take: effectiveTake + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = pairs.length > effectiveTake;
      const pageItems = hasMore ? pairs.slice(0, effectiveTake) : pairs;
      const nextCursor =
        hasMore && pageItems.length > 0
          ? (pageItems[pageItems.length - 1]?.id ?? null)
          : null;

      return success({
        pairs: pageItems.map(p => {
          const counterpartInactive = p.client_user.is_active === false;
          return {
            id: p.id,
            user_id: p.client_user_id,
            // Server-side mask: a removed client leaks neither name nor e-mail.
            name: counterpartInactive ? '' : p.client_user.name,
            email: counterpartInactive ? '' : p.client_user.email,
            paired_at: p.paired_at,
            counterpart_inactive: counterpartInactive,
          };
        }),
        nextCursor,
      });
    } else {
      // Client: return paired stylists (single query with relation include)
      // DECISION: ghost slots; two rules, hence the OR in the WHERE. (1) A LIVE stylist (account_status=ACTIVE) is
      // an ordinary row; a live but unpaid one (EXPIRING/EXPIRED) stays INVISIBLE as before (the gallery is gated on
      // account_status in gallery-paired-client, so the list cannot show a dead entrance). (2) A stylist with an
      // INACTIVE ACCOUNT (created_by_user.is_active=false after soft-delete / ban; both also set
      // account_status=NOT_ACTIVE) still counts toward the client's platform cap (ACTIVE_PAIR_FOR_CAP), so the pair IS
      // listed as "Konto nieaktywne" with identity MASKED HERE (display_name/business_name/address_city/avatar_url
      // empty) and `counterpart_inactive=true`; account_id stays because it drives "Zwolnij miejsce" (revoke-access,
      // client branch). The mask follows the is_active FLAG, not the OR branch that matched. No reconciliation on
      // account restore: an explicit action or the MOVE after 90 days frees the slot.
      const pairs = await DB_CLIENT.use.clientStylistPair.findMany({
        where: {
          client_user_id: current_user_id,
          status: PairingStatusValue.ACTIVE,
          OR: [
            { stylist_account: { account_status: AccountStatusValue.ACTIVE } },
            { stylist_account: { created_by_user: { is_active: false } } },
          ],
        },
        include: {
          stylist_account: {
            select: {
              account_id: true,
              display_name: true,
              business_name: true,
              address_city: true,
              avatar_url: true,
              created_by_user: {
                select: { image: true, avatar_url: true, is_active: true },
              },
            },
          },
        },
        // Cursor field (id) must be part of orderBy for stable pagination — paired_at is
        // non-unique, so id is the tiebreaker preventing skip/dup on page boundaries.
        orderBy: [{ paired_at: 'desc' }, { id: 'desc' }],
        take: effectiveTake + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = pairs.length > effectiveTake;
      const pageItems = hasMore ? pairs.slice(0, effectiveTake) : pairs;
      const nextCursor =
        hasMore && pageItems.length > 0
          ? (pageItems[pageItems.length - 1]?.id ?? null)
          : null;

      return success({
        salons: await getClientSalonGroups_IO(current_user_id),
        pairs: pageItems.map(p => {
          const counterpartInactive =
            p.stylist_account.created_by_user.is_active === false;
          return {
            id: p.id,
            account_id: p.stylist_account_id,
            ...(p.salon_origin_account_id !== undefined
              ? { salon_origin_account_id: p.salon_origin_account_id }
              : {}),
            // Server-side mask: a removed stylist leaks neither name, city nor avatar.
            display_name: counterpartInactive
              ? ''
              : p.stylist_account.display_name,
            business_name: counterpartInactive
              ? null
              : p.stylist_account.business_name,
            address_city: counterpartInactive
              ? null
              : p.stylist_account.address_city,
            // Canonical photo chain: own upload, then the OAuth image, then nothing
            // (the UI adds initials). This list used to read only the OAuth image,
            // so once avatar_url had a write path the client kept seeing the old
            // Google photo instead of the one the stylist had just set.
            avatar_url: counterpartInactive
              ? null
              : resolvePersonAvatarUrl(p.stylist_account.created_by_user),
            paired_at: p.paired_at,
            counterpart_inactive: counterpartInactive,
          };
        }),
        nextCursor,
      });
    }
  } catch (error) {
    // DECISION: stale-cursor handling lives in the pre-check at the top of this function; this
    // P2025 branch is only a defensive fallback (see
    // web-1/src/domain/gallery/operations/gallery-explore.query.ts).
    if (isP2025(error)) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'cursor',
        message: 'Invalid cursor',
      });
    }
    return databaseFailure('getMyPairs', error);
  }
};

/**
 * Pending requests for one stylist. PII minimum before accept: the client's
 * name only (e-mail only after ACCEPT, in get-my-pairs). Visibility matches
 * getMyPairs_IO: a removed client (is_active false) does not leak. No pagination:
 * rate-limited requests are dozens, not thousands (take 100).
 */
export const getPendingPairRequests_IO = async ({
  stylist_account_id,
}: {
  stylist_account_id: string;
}): Promise<
  OperationResult<
    {
      requests: Array<{
        pair_id: string;
        name: string;
        requested_at: Date;
        avatar_url: string | null;
        place: string | null;
        note: string | null;
      }>;
    },
    DatabaseError
  >
> => {
  try {
    // DECISION: FLAT cap 100, NO cursor, unlike the cursor-paginated getMyPairs_IO / getMySessionContainers_IO. A
    // stylist with >100 simultaneously PENDING requests is not reachable pre-launch (requests are actively
    // accepted/declined) and the consumer (usePairRequests) fetches once plus polls, with no pagination. A cursor
    // would be a DTO + frontend contract change, not a refactor. When a stylist nears the cap, mirror the
    // getMyPairs_IO cursor contract (cursor?/take? + isValidCursorFormat gate + nextCursor); the `id desc`
    // tiebreaker is already in place so a keyset migration is drop-in.
    const rows = await DB_CLIENT.use.clientStylistPair.findMany({
      where: {
        stylist_account_id,
        status: PairingStatusValue.PENDING,
        client_user: { is_active: true },
        // Hide means mute: a request on a pair the stylist hid leaves the waiting
        // list and the bell that counts this list. It returns after „Przywróć"
        // in the inbox („Pokaż ukryte"). The client sees no difference (anti-oracle).
        stylist_hidden_at: null,
      },
      include: {
        client_user: { select: { name: true, image: true, avatar_url: true } },
      },
      orderBy: [{ paired_at: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return success({
      requests: rows.map(r => ({
        pair_id: r.id,
        name: r.client_user.name,
        avatar_url: resolvePersonAvatarUrl(r.client_user),
        place: r.request_place,
        note: r.request_note,
        requested_at: r.paired_at,
      })),
    });
  } catch (error) {
    return databaseFailure('getPendingPairRequests_IO', error);
  }
};

/**
 * The CLIENT's own requests still waiting for the stylist's accept, for her dashboard. Mirror of
 * getPendingPairRequests_IO from the other side. Flat cap: a client holds at most a handful (pairing cap 3 +
 * pending), no cursor needed (same reasoning as the DECISION above).
 */
export const getMyPendingPairRequests_IO = async ({
  client_user_id,
}: {
  client_user_id: string;
}): Promise<
  OperationResult<
    {
      requests: Array<{
        pair_id: string;
        stylist_account_id: string;
        display_name: string | null;
        avatar_url: string | null;
        requested_at: Date;
      }>;
    },
    DatabaseError
  >
> => {
  try {
    const rows = await DB_CLIENT.use.clientStylistPair.findMany({
      where: {
        client_user_id,
        status: PairingStatusValue.PENDING,
      },
      include: {
        stylist_account: {
          select: {
            display_name: true,
            created_by_user: { select: { avatar_url: true, image: true } },
          },
        },
      },
      orderBy: [{ paired_at: 'desc' }, { id: 'desc' }],
      take: 20,
    });
    return success({
      requests: rows.map(r => ({
        pair_id: r.id,
        stylist_account_id: r.stylist_account_id,
        display_name: r.stylist_account.display_name,
        avatar_url: resolvePersonAvatarUrl(r.stylist_account.created_by_user),
        requested_at: r.paired_at,
      })),
    });
  } catch (error) {
    return databaseFailure('getMyPendingPairRequests_IO', error);
  }
};
