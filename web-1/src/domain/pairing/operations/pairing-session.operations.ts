import { confirmLifecycleConnection } from '@domain/email/lifecycle-connection.receipt';
import { resolveEffectivePlan_IO } from '@app/pricing/effective-plan.resolver';
import { DB_CLIENT } from '@app/db/db.client';
import { ACTIVE_PAIR_FOR_CAP } from '@domain/pairing/pairing-cap.predicates';
import {
  generatePairingToken,
  generateTokenExpiry,
} from '@domain/pairing/pairing.token.utils';
import { PAIRING_CONFIG } from '@domain/pairing/pairing.config';
import { resolvePairingTtlMinutes } from '@domain/pairing/pairing-session-ttl.resolver';
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
import { CLEARED_PAIR_REQUEST_CONTEXT } from '../pair-request.context';
import { pendingPairRequestCrmNoteWrite_IO } from '../pair-request-crm-note';

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

    // DECISION: the active-session count and the insert share one Serializable
    // transaction. A 40001 (isSerializationConflict) maps in the catch below to
    // PAIRING_TOO_MANY_ACTIVE_SESSIONS, which the error map sends as 429.
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

        // Active-session count inside the Serializable transaction above.
        // A 40001 maps in the outer catch to 429 PAIRING_TOO_MANY_ACTIVE_SESSIONS.
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
        // DECISION: the token is generated ONCE, outside any loop, with no in-tx retry on a P2002 collision. The first
        // P2002 in an interactive tx aborts the WHOLE tx in Postgres (SQLSTATE 25P02), so a retried create would throw
        // 25P02 regardless, dead code that turned a collision into an HTTP 500. The token is a 128-bit CSPRNG
        // (crypto.randomBytes(16) base64url, VarChar(32) @unique), so a real collision is astronomically unlikely; a P2002
        // maps like any other create error (outer catch -> databaseFailure). A serialization failure (40001, lost cap
        // race) must still escape the tx: the outer catch maps it to 429.
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
    // DECISION: serialization_failure (40001) = a concurrent issue lost the cap race under Serializable. The tx
    // rolled back, so the loser added no session over the cap. It maps to 429 PAIRING_TOO_MANY_ACTIVE_SESSIONS (same
    // contract as the pre-check), not DATABASE_ERROR/500; currentCount is unknown in the losing tx, so the limit is
    // reported as currentCount. Use isSerializationConflict, not `code === 'P2034'`: under @prisma/adapter-pg 40001
    // arrives as DriverAdapterError (TransactionWriteConflict) without .code, so P2034 alone is dead code.
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
    // DECISION: client and stylist cap counts plus the claim write share one
    // Serializable transaction. Different tokens do not lock each other.
    // A 40001 (isSerializationConflict) maps to retryable 429
    // PAIRING_TOO_MANY_ACTIVE_SESSIONS. PairingLimitExceededRollback maps to
    // 403 PAIRING_LIMIT_REACHED. See the outer catch.
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
        //
        // DECISION: re-claiming an EXISTING active pair (same client and stylist) is count-neutral (the step-4 upsert is
        // a no-op update that only refreshes paired_at), so the platform-cap pre-check is skipped when an ACTIVE pair for
        // exactly this (client, stylist) exists: a client at the cap of 3 who re-scans one of her 3 paired salons (e.g.
        // the stylist re-issued the QR) MUST get an idempotent 200, not a false "limit reached". The count() below
        // runs for a new pairing, inside the Serializable transaction above.
        // The post-upsert recount in step 4.1 stays as a backstop. Alone, under READ COMMITTED, it
        // did not close the race.
        const existingActivePair = await tx.clientStylistPair.findFirst({
          where: {
            salon_origin_account_id: null,
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

        // DECISION: this stylist-cap count() runs inside the Serializable
        // transaction above, and only for a new pair. A 40001 maps in the outer
        // catch to retryable 429 PAIRING_TOO_MANY_ACTIVE_SESSIONS
        // (isSerializationConflict).
        //
        // GATE !existingActivePair (mirror of step 2.1): re-claiming an EXISTING active pair is count-neutral (the
        // step-4 upsert is a no-op update), so stylistPairsCount ALREADY includes that pair. Without the gate a client
        // paired to a stylist at the cap (FREE=2, count=2 including hers) who re-scanned a still-valid QR got a false 403
        // PLAN_LIMIT (2<2 false), breaking the idempotent-200 contract of step 2.1. For a new pairing the count() runs.
        if (!existingActivePair) {
          const effective = await resolveEffectivePlan_IO({
            userId: stylistAccount.created_by_user_id,
            ownPlan: stylistAccount.pricing_plan,
            db: tx,
          });
          const pricingPlan = narrowPricingPlan(
            effective.effective_pricing_plan
          );
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
        // DECISION: the atomic guard is updateMany with a WHERE of session.id plus all race-loser predicates (unclaimed,
        // unexpired, unrevoked). A PostgreSQL UPDATE is atomic, so only one concurrent claim can match; count===0 means
        // the race was lost between findUnique (step 1) and this update, so return PAIRING_CODE_INVALID/ALREADY_CLAIMED.
        // Pattern from gallery-pin.operations.ts.
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
        // DECISION: the update branch does NOT clear crm_note: the stylist's private note about a client deliberately
        // returns on re-pair (the same relation resumes with its context), symmetric with revoke, which does not delete it
        // (pairing-revoke-core.operations.ts). Same retention model as VisitRecords.
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
            ...(await pendingPairRequestCrmNoteWrite_IO(
              tx,
              client_user_id,
              session.stylist_account_id
            )),
            ...CLEARED_PAIR_REQUEST_CONTEXT,
            // Like revoked_at: scanning the stylist's code is HER consent to resume the relation, so the trace of the
            // earlier cut no longer applies. It is the only way back for a client removed by the stylist (see the
            // CAS REVOKED->PENDING DECISION in pair-request.operations.ts); without clearing it a re-activated pair
            // would keep a stale "cut by the stylist".
            revoked_by: null,
            paired_via_pairing_session_id: session.id,
            salon_origin_account_id: null,
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

        // DECISION: pairing does NOT create a FavoriteStylist. SSOT §5.1 and the R5 change (owner) removed
        // auto-follow on pairing (§5.7 = the "Sparowano!" badge; a pair is not a like).

        if (!existingActivePair) {
          await confirmLifecycleConnection(
            tx,
            session.stylist_account_id,
            stylistAccount.created_by_user_id
          );
        }

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
    // DECISION: keep the two paths DISTINCT, do not merge them.
    // (A) PairingLimitExceededRollback -> 403 PAIRING_LIMIT_REACHED (respondPlanLimitReached): a REAL breach. The step-4
    //     upsert passed and the post-upsert recount (step 4.1) proved the client IS over the platform cap
    //     (MAX_PAIRED_STYLISTS). The throw rolls back the pair, but the caller is at/over the cap, a retry changes
    //     nothing, so the answer is a hard 403 with the real currentCount.
    // (B) serialization_failure (40001) -> 429 PAIRING_TOO_MANY_ACTIVE_SESSIONS (respondTooManyRequests, RETRYABLE):
    //     NOT a breach. SSI aborted the losing tx on an rw-antidependency (e.g. concurrent claims of different salons
    //     by one client over the cap, or an unrelated conflict such as claim+revoke of the same session). The tx rolled
    //     back, so no pair was added, but the abort does not prove she was over the cap; mapping it to 403 PLAN_LIMIT
    //     would be a misleading "limit reached". On retry a real overrun hits the pre-check (2.1/2.2) and gets the
    //     deterministic 403; otherwise it passes. Same as issuePairingSession (40001 -> 429). currentCount is unknown
    //     in the rolled-back tx, so the limit is reported as currentCount. Use isSerializationConflict, not
    //     `code === 'P2034'`: under @prisma/adapter-pg 40001 is a DriverAdapterError (TransactionWriteConflict)
    //     without .code.
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
