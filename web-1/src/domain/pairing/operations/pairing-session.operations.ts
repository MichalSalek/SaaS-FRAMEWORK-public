import { DB_CLIENT } from '@app/db/db.client';
import { ACTIVE_PAIR_FOR_CAP } from '@domain/pairing/pairing-cap.predicates';
import {
  generatePairingToken,
  generateTokenExpiry,
} from '@domain/pairing/pairing.token.utils';
import { PAIRING_CONFIG } from '@domain/pairing/pairing.config';
import { getRuntimeConfigValue } from '@domain/admin/operations/admin-runtime-config.operations';
import { getPlanConfig } from '@app/pricing/plan-config.cache';
import {
  PRICING_POLICY,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import {
  type OperationResult,
  success,
  failure,
} from '@kernel/application/result.types';
import type {
  PairingLimitReachedError,
  PairingTooManyActiveSessionsError,
  PairingCodeInvalidError,
} from '@kernel/domain/pairing/pairing-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import { USER_POLICY } from '@kernel/policies/user.policy';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isSerializationConflict } from '@app/db/serialization-conflict';
import { PairingLimitExceededRollback } from './pairing-rollback.helper';

// DECISION (nie usuwaj tego komentarza):
// Resolve pairing token TTL (minutes) from the runtime-config override
// (PAIRING_SESSION_TTL_MINUTES) with a HARD security clamp. getRuntimeConfigValue
// returns a raw DB string; even though the admin validator enforces min:1/max:60,
// this defense-in-depth clamp guarantees an out-of-range / NaN / stale row can NEVER
// extend the token lifetime past 60 min (the token is a short-lived offline→online
// QR bridge). Default = PAIRING_CONFIG.TOKEN_TTL_MINUTES (15) when unset/invalid.
const MAX_PAIRING_TTL_MINUTES = 60;

const resolvePairingTtlMinutes = async (): Promise<number> => {
  const raw = await getRuntimeConfigValue(
    'PAIRING_SESSION_TTL_MINUTES',
    String(PAIRING_CONFIG.TOKEN_TTL_MINUTES)
  );
  const parsed = Number(raw);
  const isValid =
    Number.isInteger(parsed) &&
    parsed >= 1 &&
    parsed <= MAX_PAIRING_TTL_MINUTES;
  if (!isValid) {
    return PAIRING_CONFIG.TOKEN_TTL_MINUTES;
  }
  return parsed;
};

/** Issue pairing session (stylist generates QR) */
export const issuePairingSession_IO = async ({
  stylist_account_id,
  issued_by_user_id,
  pricing_plan,
}: {
  stylist_account_id: string;
  issued_by_user_id: string;
  pricing_plan: PricingPlan;
}): Promise<
  OperationResult<
    { token: string; expires_at: Date; stylist_account_id: string },
    PairingLimitReachedError | PairingTooManyActiveSessionsError | DatabaseError
  >
> => {
  try {
    // Pre-fetch plan config outside transaction (immutable config, no race risk)
    const planConfig = await getPlanConfig(pricing_plan);

    // Resolve token TTL (minutes) OUTSIDE the Serializable tx — same rationale as
    // planConfig: a DB read inside the tx would add SIReadLocks/extend its predicate
    // surface. Clamped to a safe range (see resolvePairingTtlMinutes).
    const ttlMinutes = await resolvePairingTtlMinutes();

    // All checks + creation inside a SERIALIZABLE transaction to prevent race conditions.
    // DECISION (nie usuwaj tego komentarza):
    // isolationLevel Serializable jest TWARDYM guardem na TOCTOU active-session capa
    // (pairing-1). Pre-check count() w kroku 2 staje się punktem serializacji: Postgres SSI
    // zakłada predicate-lock (SIReadLock) na zliczanym zakresie, więc gdy współbieżne issue
    // wszystkie odczytają count<cap i każde wstawi wiersz do tego zakresu, przy commicie
    // wykrywa rw-antidependency i aborbuje przegranych z P2034 (40001). Efekt: NIGDY > cap
    // commituje (nadmiar odrzucony jako 429). READ COMMITTED tego NIE domyka — poprzedni
    // fix (post-create recount, krok 4.1) zawodził, bo recount w wyścigu też czytał świeży,
    // ale wciąż przed-commitowy snapshot innych tx (burst 20 → 9 aktywnych). Wzorzec:
    // export-user-data.operations.ts (reserveExportSlot: count+create pod Serializable + P2034).
    return await DB_CLIENT.use.$transaction(
      async tx => {
        // 1. Check pairing limit (from PRICING_POLICY - SSOT)
        const pairsCount = await tx.clientStylistPair.count({
          where: { stylist_account_id, ...ACTIVE_PAIR_FOR_CAP },
        });

        if (!PRICING_POLICY.utils.canPairClient(planConfig, pairsCount)) {
          return failure({
            type: 'PAIRING_LIMIT_REACHED',
            currentCount: pairsCount,
            limit: planConfig.max_paired_clients,
            planType: pricing_plan,
          });
        }

        // 2. Check max active sessions (prevent token spam) — SERIALIZATION POINT.
        // DECISION (nie usuwaj tego komentarza):
        // Ten count() pod Serializable (patrz wrapper $transaction wyżej) JEST
        // twardym guardem capa: predicate-lock na zliczanym zakresie sprawia, że
        // współbieżne issue, które wszystkie odczytają count<cap i wstawią wiersz,
        // tworzą rw-conflict → Postgres aborbuje przegranych przy commicie (P2034),
        // łapanym w zewnętrznym catch jako 429. To NIE jest tylko fast-fail —
        // pod READ COMMITTED ten sam pre-check przepuszczał wyścig (pairing-1).
        // Nie ma osobnego post-create recountu: niepotrzebny (count = serializacja)
        // i udowodniono, że recount sam w sobie wyścigu nie domyka.
        const activeSessions = await tx.pairingSession.count({
          where: {
            stylist_account_id,
            claimed_by_client_user_id: null,
            expires_at: { gt: new Date() },
            revoked_at: null,
          },
        });

        if (activeSessions >= PAIRING_CONFIG.MAX_ACTIVE_SESSIONS_PER_STYLIST) {
          return failure({
            type: 'PAIRING_TOO_MANY_ACTIVE_SESSIONS',
            currentCount: activeSessions,
            limit: PAIRING_CONFIG.MAX_ACTIVE_SESSIONS_PER_STYLIST,
          });
        }

        // 3. Generate token + TTL.
        // DECISION (nie usuwaj tego komentarza):
        // Token jest generowany RAZ, POZA pętlą i nie ma in-tx retry na kolizji P2002
        // (pairing-l2-3). Pierwszy P2002 w interaktywnej tx Postgres aborbuje CAŁĄ tx
        // (SQLSTATE 25P02 — "current transaction is aborted"), więc każdy kolejny statement
        // (retry create) i tak rzuca 25P02 niezależnie od unikalności nowego tokena → retry
        // w tej samej tx był MARTWYM KODEM, który zamieniał kolizję w HTTP 500. Token to
        // 128-bit CSPRNG (crypto.randomBytes(16) base64url, kolumna VarChar(32) @unique) —
        // realna kolizja jest astronomicznie nieprawdopodobna przy dowolnym wolumenie sesji,
        // więc pojedyncza próba wystarcza; ewentualny P2002 mapujemy czysto jak każdy inny
        // create-error (zewnętrzny catch → databaseFailure), nie udajemy odzysku. Retry
        // CAŁEJ tx (poza nią) byłby poprawnym, ale niepotrzebnym narzutem dla zdarzenia,
        // które praktycznie nie zachodzi. Serialization-failure (40001 = przegrany wyścig
        // capa) NADAL musi wypłynąć z tx — łapie go zewnętrzny catch i mapuje na 429.
        const expires_at = generateTokenExpiry({
          ttlMinutes,
        });
        const token = generatePairingToken();

        // 4. Create session (single-shot — kolizja tokena praktycznie niemożliwa, patrz wyżej)
        const session = await tx.pairingSession.create({
          data: {
            token,
            stylist_account_id,
            issued_by_user_id,
            expires_at,
          },
          select: {
            token: true,
            expires_at: true,
            stylist_account_id: true,
          },
        });

        return success(session);
      },
      { isolationLevel: 'Serializable' }
    );
  } catch (error) {
    // DECISION (nie usuwaj tego komentarza):
    // serialization_failure (40001) = współbieżne issue przegrało wyścig o cap pod
    // Serializable (pairing-1). tx została zrollowana (create cofnięty), więc loser
    // NIE dołożył sesji ponad cap. Mapuj na 429 PAIRING_TOO_MANY_ACTIVE_SESSIONS
    // (ten sam kontrakt co pre-check), nie na DATABASE_ERROR/500. currentCount nie
    // jest znany w przegranej tx → raportujemy limit jako currentCount (klient i tak
    // dostaje semantykę "za dużo aktywnych sesji"). isSerializationConflict, NIE sam
    // `code === 'P2034'`: pod @prisma/adapter-pg 40001 wychodzi jako DriverAdapterError
    // (TransactionWriteConflict) bez .code — sam P2034 to martwy kod. Wzorzec: export-user-data.
    if (isSerializationConflict(error)) {
      return failure({
        type: 'PAIRING_TOO_MANY_ACTIVE_SESSIONS',
        currentCount: PAIRING_CONFIG.MAX_ACTIVE_SESSIONS_PER_STYLIST,
        limit: PAIRING_CONFIG.MAX_ACTIVE_SESSIONS_PER_STYLIST,
      });
    }
    return databaseFailure('issuePairingSession', error);
  }
};

/** Claim pairing session (client scans QR) */
export const claimPairingSession_IO = async ({
  token,
  client_user_id,
}: {
  token: string;
  client_user_id: string;
}): Promise<
  OperationResult<
    {
      stylist_account_id: string;
      display_name: string | null;
      paired_at: Date;
      stylist_user_id: string;
      stylist_email: string | null;
      stylist_name: string | null;
    },
    | PairingCodeInvalidError
    | PairingLimitReachedError
    | PairingTooManyActiveSessionsError
    | DatabaseError
  >
> => {
  try {
    // All validation + cap checks + write inside a SERIALIZABLE transaction.
    // DECISION (nie usuwaj tego komentarza):
    // isolationLevel Serializable jest TWARDYM guardem na TOCTOU obu capów claim
    // (pairing-l2-1 = CLIENT platform-cap MAX_PAIRED_STYLISTS, pairing-l2-2 = STYLIST
    // plan-cap max_paired_clients). Pre-check count() w krokach 2.1 i 2.2 staje się
    // punktem serializacji: Postgres SSI zakłada predicate-lock (SIReadLock) na zliczanym
    // zakresie, więc gdy współbieżne claim (różne tokeny → różne sesje, których atomic
    // updateMany w kroku 3 NIE serializuje między sobą) wszystkie odczytają count<cap i
    // każde wstawi/zaktualizuje wiersz w tym zakresie, przy commicie wykrywa rw-antidependency
    // i aborbuje przegranych z 40001. Efekt: NIGDY > cap commituje. READ COMMITTED tego NIE
    // domyka — pre-check (krok 2.2) ani post-recount pod READ COMMITTED (krok 4.1, klient)
    // przepuszczały wyścig (sibling issuePairingSession: "burst 20 → 9 aktywnych"). Loser
    // (40001) jest mapowany w zewnętrznym catch na 429 PAIRING_TOO_MANY_ACTIVE_SESSIONS
    // (RETRYABLE — abort NIE dowodzi breachu; przy realnym capie retry trafi w pre-check
    // i dostanie poprawne 403). PRAWDZIWY breach (post-upsert recount, krok 4.1) →
    // PairingLimitExceededRollback → 403 PAIRING_LIMIT_REACHED. Pełne uzasadnienie rozróznienia
    // w zewnętrznym catch. Wzorzec 1:1 z issuePairingSession (Serializable + isSerializationConflict).
    return await DB_CLIENT.use.$transaction(
      async tx => {
        // 1. Find session
        const session = await tx.pairingSession.findUnique({
          where: { token },
          select: {
            id: true,
            stylist_account_id: true,
            claimed_by_client_user_id: true,
            expires_at: true,
            revoked_at: true,
          },
        });

        // 2. Validate
        if (!session) {
          return failure({
            type: 'PAIRING_CODE_INVALID',
            code: token,
            reason: 'NOT_FOUND',
          });
        }
        if (session.claimed_by_client_user_id) {
          return failure({
            type: 'PAIRING_CODE_INVALID',
            code: token,
            reason: 'ALREADY_CLAIMED',
          });
        }
        if (session.revoked_at) {
          return failure({
            type: 'PAIRING_CODE_INVALID',
            code: token,
            reason: 'REVOKED',
          });
        }
        if (session.expires_at < new Date()) {
          return failure({
            type: 'PAIRING_CODE_INVALID',
            code: token,
            reason: 'EXPIRED',
          });
        }

        // 2.1 Check CLIENT'S platform limit (max paired stylists — platform constant, not per-plan)
        // Count actual pairings (ClientStylistPair), NOT bookmarks — bookmark has no limit.
        //
        // DECISION (nie usuwaj tego komentarza):
        // Re-claim ISTNIEJĄCEJ aktywnej pary (ten sam client↔stylist) jest
        // count-neutral — upsert w kroku 4 to no-op update (tylko odświeża
        // paired_at). Dlatego pomijamy platform-cap pre-check, gdy ACTIVE para dla
        // dokładnie tej (client, stylist) już istnieje: klient na capie 3, który
        // re-skanuje jeden z 3 już sparowanych salonów (np. stylistka re-issue QR),
        // MUSI dostać idempotentny 200, nie fałszywy "limit reached". Twardy guard
        // capa dla NOWYCH parowań: count() poniżej JEST punktem serializacji pod
        // Serializable (patrz wrapper $transaction wyżej, pairing-l2-1) — współbieżne
        // claim różnych salonów przez tego samego klienta tworzą rw-conflict i loser
        // aborbuje (40001 → retryable 429 PAIRING_TOO_MANY_ACTIVE_SESSIONS w zewnętrznym
        // catch; retry trafia w ten pre-check i dostaje zdeterminowane 403, gdy klient
        // realnie jest nad capem). Post-upsert recount w kroku 4.1 zostaje jako
        // belt-and-suspenders backstop (sam pod READ COMMITTED wyścigu NIE domykał).
        const existingActivePair = await tx.clientStylistPair.findFirst({
          where: {
            client_user_id,
            stylist_account_id: session.stylist_account_id,
            status: PairingStatusValue.ACTIVE,
          },
          select: { id: true },
        });

        if (!existingActivePair) {
          const clientPairingsCount = await tx.clientStylistPair.count({
            where: { client_user_id, ...ACTIVE_PAIR_FOR_CAP },
          });

          if (!PRICING_POLICY.utils.canPairStylist(clientPairingsCount)) {
            return failure({
              type: 'PAIRING_LIMIT_REACHED',
              currentCount: clientPairingsCount,
              limit: PRICING_POLICY.PLATFORM_LIMITS.MAX_PAIRED_STYLISTS,
              planType: 'PLATFORM',
            });
          }
        }

        // 2.2 Recheck STYLIST's pairing limit (may have changed since session was issued)
        const stylistAccount = await tx.stylistAccount.findUnique({
          where: { account_id: session.stylist_account_id },
          select: {
            pricing_plan: true,
            created_by_user_id: true,
            display_name: true,
            account_status: true,
          },
        });

        if (
          !stylistAccount ||
          !USER_POLICY.utils.IS_ACCOUNT_STATUS_ACTIVE(
            stylistAccount.account_status
          )
        ) {
          return failure({
            type: 'PAIRING_CODE_INVALID',
            code: token,
            reason: 'STYLIST_INACTIVE',
          });
        }

        // Block self-pairing: a dual-role user (CLIENT owning a stylist_account) must not pair
        // with their own account — para to relacja klient↔inna stylistka. Mask as NOT_FOUND
        // (no reason leaking that the code belongs to the claimer's own account).
        if (stylistAccount.created_by_user_id === client_user_id) {
          return failure({
            type: 'PAIRING_CODE_INVALID',
            code: token,
            reason: 'NOT_FOUND',
          });
        }

        // DECISION (nie usuwaj tego komentarza):
        // Ten count() (STYLIST plan-cap max_paired_clients, np. FREE=2) pod Serializable
        // (patrz wrapper $transaction wyżej) JEST twardym guardem capa, NIE tylko pre-check
        // (pairing-l2-2). Predicate-lock na zakresie WHERE stylist_account_id sprawia, że
        // współbieżne claim RÓŻNYCH klientów dla TEJ SAMEJ stylistki (różne tokeny → różne
        // sesje; atomic updateMany w kroku 3 ich NIE serializuje między sobą) tworzą rw-conflict
        // → loser aborbuje przy commicie (40001 → retryable 429 w zewnętrznym catch, patrz
        // DECISION tam: abort nie dowodzi przekroczenia capa; retry trafia w ten count i
        // dostaje zdeterminowane 403, gdy cap jest realnie osiągnięty). Pod READ COMMITTED
        // ten sam pre-check przepuszczał wyścig (wszyscy czytali count<cap), a osobny post-recount
        // pod READ COMMITTED też nie domykał (sibling issuePairingSession: "burst 20 → 9"). Dlatego
        // NIE dokładamy stylist-side post-recountu — count = serializacja wystarcza (wzorzec issue).
        //
        // GATE !existingActivePair (pairing-1, mirror kroku 2.1): re-claim ISTNIEJĄCEJ
        // aktywnej pary (ten sam client↔stylist) jest count-neutral — upsert w kroku 4 to
        // no-op update (status zostaje ACTIVE, tylko paired_at), więc stylistPairsCount JUŻ
        // zawiera tę parę i NIE rośnie. Bez tego gate'a klient sparowany ze stylistką na
        // capie (np. FREE=2, count=2 wliczając jego parę) re-skanujący wciąż-ważny QR tej
        // samej stylistki dostawał fałszywe 403 PLAN_LIMIT (count<cap → 2<2 → false), łamiąc
        // idempotent-200 kontrakt z kroku 2.1. Twardy guard capa dla NOWYCH parowań trzyma:
        // gdy existingActivePair == null, count() poniżej WYKONUJE się i pozostaje punktem
        // serializacji (różni klienci → ten sam stylist NAD capem = rw-conflict → loser 40001).
        // Re-claim (count-neutral, brak nowego wiersza) nie musi w tej serializacji uczestniczyć.
        if (!existingActivePair) {
          const pricingPlan = narrowPricingPlan(stylistAccount.pricing_plan);
          const planConfig = await getPlanConfig(pricingPlan);
          const stylistPairsCount = await tx.clientStylistPair.count({
            where: {
              stylist_account_id: session.stylist_account_id,
              ...ACTIVE_PAIR_FOR_CAP,
            },
          });
          if (
            !PRICING_POLICY.utils.canPairClient(planConfig, stylistPairsCount)
          ) {
            return failure({
              type: 'PAIRING_LIMIT_REACHED',
              currentCount: stylistPairsCount,
              limit: planConfig.max_paired_clients,
              planType: pricingPlan,
            });
          }
        }

        // 3. Mark as claimed (single-use)
        // DECISION (nie usuwaj tego komentarza):
        // Atomic guard via updateMany — WHERE includes session.id + all race-loser predicates
        // (unclaimed, unexpired, unrevoked). PostgreSQL UPDATE is atomic, so only one concurrent
        // claim can match the row. If count===0, we lost the race between findUnique (step 1)
        // and this update — return PAIRING_CODE_INVALID/ALREADY_CLAIMED. Pattern from
        // gallery-pin.operations.ts (lines 70-77).
        const claimResult = await tx.pairingSession.updateMany({
          where: {
            id: session.id,
            claimed_by_client_user_id: null,
            revoked_at: null,
            expires_at: { gt: new Date() },
          },
          data: {
            claimed_by_client_user_id: client_user_id,
            claimed_at: new Date(),
          },
        });

        if (claimResult.count === 0) {
          // Race-loser: another concurrent claim won. Return ALREADY_CLAIMED — most likely
          // cause (token expired/revoked between findUnique and updateMany is also valid).
          return failure({
            type: 'PAIRING_CODE_INVALID',
            code: token,
            reason: 'ALREADY_CLAIMED',
          });
        }

        // 4. Create permanent access grant (idempotent)
        //    If previously REVOKED → reactivate with new paired_at + clear revoked_at
        //    If already ACTIVE → no-op (idempotent)
        // DECISION (nie usuwaj tego komentarza): update-branch NIE zeruje crm_note — prywatna notatka
        // stylistki o klientce z poprzedniej relacji CELOWO wraca przy re-pair (wznowienie tej samej
        // relacji z zachowanym kontekstem). Symetryczne z revoke, które jej nie kasuje
        // (pairing-access.operations.ts). Model retencji projektu (VisitRecords persystują tak samo).
        const pair = await tx.clientStylistPair.upsert({
          where: {
            client_user_id_stylist_account_id: {
              client_user_id,
              stylist_account_id: session.stylist_account_id,
            },
          },
          create: {
            client_user_id,
            stylist_account_id: session.stylist_account_id,
            paired_at: new Date(),
            paired_via_pairing_session_id: session.id,
          },
          update: {
            status: PairingStatusValue.ACTIVE,
            paired_at: new Date(),
            revoked_at: null,
            // Symetrycznie do revoked_at: zeskanowanie kodu stylistki to JEJ zgoda na
            // wznowienie relacji, więc ślad po poprzednim zerwaniu przestaje
            // obowiązywać. To jedyna droga powrotu dla klientki usuniętej przez
            // stylistkę (patrz DECISION przy CAS REVOKED->PENDING w
            // pair-request.operations.ts) — bez tego zerowania zostawialibyśmy
            // nieaktualne „zerwała stylistka" na parze znowu aktywnej.
            revoked_by: null,
            paired_via_pairing_session_id: session.id,
          },
          select: {
            stylist_account_id: true,
            paired_at: true,
          },
        });

        // 4.1 Post-upsert limit verification (defense against concurrent claims — throw to rollback tx)
        const postPairCount = await tx.clientStylistPair.count({
          where: { client_user_id, ...ACTIVE_PAIR_FOR_CAP },
        });
        if (!PRICING_POLICY.utils.canPairStylist(postPairCount - 1)) {
          throw new PairingLimitExceededRollback(postPairCount);
        }

        // DECISION (nie usuwaj tego komentarza):
        // Parowanie NIE tworzy FavoriteStylist. SSOT §5.1 + zmiana R5 (2026-04-28) cofnęły
        // auto-follow przy parowaniu (§5.7 = badge "Sparowano!", relacja para ≠ polubienie).

        // 5. Resolve stylist user details (reuse stylistAccount from step 2.2).
        // stylistAccount is non-null here (the `!stylistAccount` guard above returns
        // early) and StylistAccount.created_by_user_id is `String @unique` (non-nullable
        // in schema) — so stylistUserId is always a real id. The previous `?? ''` +
        // `stylistUserId ? ... : null` fallback was dead (empty id never occurs).
        const stylistUserId = stylistAccount.created_by_user_id;
        const stylistUser = await tx.user.findUnique({
          where: { id: stylistUserId },
          select: { email: true, name: true },
        });

        return success({
          stylist_account_id: pair.stylist_account_id,
          display_name: stylistAccount.display_name ?? null,
          paired_at: pair.paired_at,
          stylist_user_id: stylistUserId,
          stylist_email: stylistUser?.email ?? null,
          stylist_name: stylistUser?.name ?? null,
        });
      },
      { isolationLevel: 'Serializable' }
    );
  } catch (error) {
    // DECISION (nie usuwaj tego komentarza):
    // ROZRÓŻNIENIE real-cap-breach (403) vs serialization-abort (429-retry) — dwie różne
    // ścieżki, NIE wolno ich zlewać:
    //
    // (A) PairingLimitExceededRollback → 403 PAIRING_LIMIT_REACHED (respondPlanLimitReached).
    //     To PRAWDZIWY breach: upsert w kroku 4 PRZESZEDŁ, a post-upsert recount (krok 4.1)
    //     udowodnił, że klient JEST nad platform-capem (MAX_PAIRED_STYLISTS). Throw rolluje tx
    //     (para cofnięta), ale fakt pozostaje: caller jest na/ponad capem → retry NIC nie zmieni,
    //     poprawna odpowiedź to twarde 403 z faktycznym currentCount.
    //
    // (B) serialization_failure (40001) → 429 PAIRING_TOO_MANY_ACTIVE_SESSIONS
    //     (respondTooManyRequests, RETRYABLE). To NIE jest breach: Postgres SSI aborbował
    //     przegraną tx z powodu rw-antidependency (np. współbieżny claim różnych salonów przez
    //     tego samego klienta NAD capem — pairing-l2-1, LUB inny rw-conflict niezwiązany z capem,
    //     np. concurrent claim+revoke tej samej sesji). tx zrollowana → loser NIE dołożył pary
    //     (security trzyma), ale NIE wiemy, czy realnie był nad capem — abort sam w sobie tego
    //     NIE dowodzi. Dlatego NIE mapujemy na 403 PLAN_LIMIT (to mylące „limit reached", gdy
    //     klient capa nie przekroczył). Klient ma RETRY: jeśli realnie nad capem → retry trafi
    //     w pre-check (kroki 2.1/2.2) i dostanie poprawne, zdeterminowane 403; jeśli nie →
    //     przejdzie. Spójne 1:1 z issuePairingSession (40001 → 429). currentCount nie jest znany
    //     w przegranej tx (zrollowana przed odczytem) — raportujemy limit jako currentCount, klient
    //     dostaje retryable semantykę „spróbuj ponownie". isSerializationConflict, NIE sam
    //     `code === 'P2034'`: pod @prisma/adapter-pg 40001 wychodzi jako DriverAdapterError
    //     (TransactionWriteConflict) bez .code. Wzorzec 1:1 z issuePairingSession.
    if (error instanceof PairingLimitExceededRollback) {
      return failure({
        type: 'PAIRING_LIMIT_REACHED',
        currentCount: error.currentCount,
        limit: PRICING_POLICY.PLATFORM_LIMITS.MAX_PAIRED_STYLISTS,
        planType: 'PLATFORM',
      });
    }
    if (isSerializationConflict(error)) {
      return failure({
        type: 'PAIRING_TOO_MANY_ACTIVE_SESSIONS',
        currentCount: PRICING_POLICY.PLATFORM_LIMITS.MAX_PAIRED_STYLISTS,
        limit: PRICING_POLICY.PLATFORM_LIMITS.MAX_PAIRED_STYLISTS,
      });
    }
    return databaseFailure('claimPairingSession', error);
  }
};
