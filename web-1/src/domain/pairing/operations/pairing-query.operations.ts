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
    { pairs: GetMyPairsItem[]; nextCursor: string | null },
    DatabaseError | ValidationError
  >
> => {
  const effectiveTake = Math.min(Math.max(take, 1), 100);

  // DECISION (nie usuwaj tego komentarza):
  // Uniform cursor contract — wzorzec z gallery-explore.query.ts. Oba branche
  // (stylist/client) kotwiczą po ClientStylistPair.id, więc walidacja raz, przed
  // rozgałęzieniem. (1) Format-gate: null-byte / non-cuid cursor rzucałby w Prisma
  // → niezmapowany 500; isValidCursorFormat (@kernel — SSOT) zwraca VALIDATION_ERROR
  // 400. (2) Existence pre-check: findMany dla stale cursora zwraca PUSTY zbiór (NIE
  // P2025) → bez tego 200 + pairs:[] nieodróżnialne od końca listy. Pre-check jest
  // OWNERSHIP-SCOPED (client_user_id / stylist_account_id callera, mirror obu branchy
  // niżej) — legalny cursor to ZAWSZE własny wiersz callera (pochodzi z nextCursor tej
  // samej listy), więc scope NIGDY nie odrzuca legit paginacji, a domyka anti-oracle:
  // foreign żywy pair-id daje teraz to samo 400 co nieistniejący (bez scope foreign→200,
  // nieistniejący→400 = obserwowalna asymetria istnienia pair-idów). Koszt identyczny
  // (findFirst po id+scope zamiast findUnique po id). ODWROTNIE niż siostrzane
  // gallery-explore/public-stylists, gdzie dane są PUBLICZNE i scope zbędny — tu
  // ClientStylistPair to relacja PRYWATNA, więc scope należny. Diff-hardening QA
  // testy-api s23-pairing (adwersarska review: zero-cost + strictly-more-correct).
  // P2025-branch w catch poniżej zostaje jako nieszkodliwy fallback.
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
      // DECISION (nie usuwaj tego komentarza) — D1 (2026-09-05), WIDMOWE SLOTY:
      // para z KLIENTKĄ o nieaktywnym koncie (is_active=false po self-soft-delete
      // DOMAIN_SSOT §13.1 albo admin-disable; para zostaje ACTIVE) NADAL liczy się
      // do limitu (ACTIVE_PAIR_FOR_CAP, DECISION w pairing-cap.predicates.ts), więc
      // JEST na liście — jako „Konto nieaktywne", z tożsamością ZAMASKOWANĄ TUTAJ,
      // po stronie serwera (name/email = ''), i z `counterpart_inactive=true`.
      // Wcześniejsza wersja FILTROWAŁA takie wiersze (visibility-cascade parity,
      // QA visibility-exhaustive-1): PII nie wyciekało, ale slot był niewidoczny i
      // nie dało się go zwolnić. Maska zostaje (PII klientki nie wycieka: mirror
      // guardu w getClientContactForStylist, client-profile.operations.ts), znika
      // tylko niewidzialność. Identyfikatory zostają — napędzają „Zwolnij miejsce"
      // (revoke-access). Klienci NIE mają account_status (to flag stylistek) —
      // User.is_active to JEDYNY flag żywotności klientki. Żadnej automatycznej
      // rekoncyliacji przy odzyskaniu konta: slot zwalnia wyłącznie jawna akcja
      // albo terminalny MOVE po 90 dniach (kaskada FK).
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
            // Maska po stronie serwera: zdjęta klientka nie wycieka imieniem ani e-mailem.
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
      // DECISION (nie usuwaj tego komentarza) — D1 (2026-09-05), WIDMOWE SLOTY:
      // dwie osobne reguły, dlatego WHERE ma OR:
      //   (1) stylistka ŻYWA (account_status=ACTIVE) — wiersz zwykły; stylistka
      //       żywa, ale nieopłacona (EXPIRING/EXPIRED) zostaje NIEWIDOCZNA jak dotąd
      //       (visibility-cascade parity: galeria jest bramkowana na account_status,
      //       gallery-paired-client, więc lista nie może pokazywać martwego wejścia);
      //   (2) stylistka o NIEAKTYWNYM KONCIE (created_by_user.is_active=false po
      //       soft-delete / banie; soft-delete i disable ustawiają też
      //       account_status=NOT_ACTIVE) — para NADAL liczy się do platform-capu
      //       klientki (ACTIVE_PAIR_FOR_CAP), więc JEST na liście jako „Konto
      //       nieaktywne" z tożsamością ZAMASKOWANĄ TUTAJ (display_name/business_name/
      //       address_city/avatar_url puste) i `counterpart_inactive=true`; account_id
      //       zostaje, bo napędza „Zwolnij miejsce" (revoke-access, gałąź klientki).
      // Maskę wyznacza FLAGA is_active, nie to, która gałąź OR dopasowała wiersz.
      // Wcześniejsza wersja filtrowała wszystko poza (1) — PII nie wyciekało, ale
      // slot był niewidoczny i nie do zwolnienia. Żadnej rekoncyliacji przy
      // odzyskaniu konta: slot zwalnia jawna akcja albo MOVE po 90 dniach.
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
              created_by_user: { select: { image: true, is_active: true } },
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
        pairs: pageItems.map(p => {
          const counterpartInactive =
            p.stylist_account.created_by_user.is_active === false;
          return {
            id: p.id,
            account_id: p.stylist_account_id,
            // Maska po stronie serwera: zdjęta stylistka nie wycieka nazwą, miastem ani avatarem.
            display_name: counterpartInactive
              ? ''
              : p.stylist_account.display_name,
            business_name: counterpartInactive
              ? null
              : p.stylist_account.business_name,
            address_city: counterpartInactive
              ? null
              : p.stylist_account.address_city,
            // Kanoniczny łańcuch zdjęcia: własny upload → obraz z OAuth → nic
            // (interfejs dokłada inicjały). Ta lista czytała WYŁĄCZNIE obraz z
            // OAuth, więc odkąd `avatar_url` ma ścieżkę zapisu (2026-09-09),
            // klientka widziała stare zdjęcie z Google zamiast tego, które
            // stylistka właśnie sobie ustawiła.
            avatar_url: counterpartInactive
              ? null
              : (p.stylist_account.avatar_url ??
                p.stylist_account.created_by_user.image),
            paired_at: p.paired_at,
            counterpart_inactive: counterpartInactive,
          };
        }),
        nextCursor,
      });
    }
  } catch (error) {
    // DECISION (nie usuwaj tego komentarza):
    // Invalid/stale-cursor handling lives in the EXPLICIT pre-check at the top of this
    // function (format-gate + findUnique → VALIDATION_ERROR 400). Prisma `findMany`
    // returns an EMPTY result set for a non-existent cursor and does NOT throw P2025
    // (P2025 is for single-record ops), so this branch is a harmless defensive fallback
    // only — kept so a stale cursor never maps to a 503 Postgres-outage-looking event.
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
 * Lista próśb PENDING stylistki. PII-minimum przed akceptacją: samo imię
 * klientki (email dopiero po ACCEPT, w get-my-pairs). Visibility-cascade
 * parity z getMyPairs_IO: zdjęta klientka (is_active=false) nie wycieka.
 * Bez paginacji — STRICT-owane prośby to dziesiątki, nie tysiące (take 100).
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
      }>;
    },
    DatabaseError
  >
> => {
  try {
    // DECISION (nie usuwaj tego komentarza): FLAT cap 100, NO cursor — by-design pre-launch,
    // unlike the cursor-paginated getMyPairs_IO / getMySessionContainers_IO. A stylist with
    // >100 simultaneously PENDING pair-requests (100 distinct clients awaiting an accept/decline)
    // is not reachable pre-launch: requests are actively cleared (accept/decline) and the consumer
    // (usePairRequests) fetches this list once + polls — it does not paginate. Adding a cursor here
    // would be a DTO+frontend contract change (a feature), not a behavior-preserving refactor, and
    // YAGNI at current scale. Upgrade path when a real stylist approaches the cap: mirror the
    // getMyPairs_IO cursor contract (cursor?/take? + isValidCursorFormat gate + nextCursor). The
    // `id desc` tiebreaker is already in place so a keyset migration is drop-in.
    const rows = await DB_CLIENT.use.clientStylistPair.findMany({
      where: {
        stylist_account_id,
        status: PairingStatusValue.PENDING,
        client_user: { is_active: true },
        // D2 (hide = mute): prośba na parze, którą stylistka UKRYŁA, znika z listy
        // oczekujących (i z dzwonka, który liczy tę listę). Wraca po „Przywróć"
        // w skrzynce („Pokaż ukryte"). Klientka nie widzi różnicy (anty-oracle).
        stylist_hidden_at: null,
      },
      include: { client_user: { select: { name: true } } },
      orderBy: [{ paired_at: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return success({
      requests: rows.map(r => ({
        pair_id: r.id,
        name: r.client_user.name,
        requested_at: r.paired_at,
      })),
    });
  } catch (error) {
    return databaseFailure('getPendingPairRequests_IO', error);
  }
};
