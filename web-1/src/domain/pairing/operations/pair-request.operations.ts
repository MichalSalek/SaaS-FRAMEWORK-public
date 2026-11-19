import { confirmLifecycleConnection } from '@domain/email/lifecycle-connection.receipt';
import { DB_CLIENT } from '@app/db/db.client';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { ACTIVE_PAIR_FOR_CAP } from '@domain/pairing/pairing-cap.predicates';
import { getPlanConfig } from '@app/pricing/plan-config.cache';
import { batchResolveLocales } from '@app/email-handler/lifecycle/email-locale-batch.resolver';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
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
  PairRequestNotFoundError,
} from '@kernel/domain/pairing/pairing-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import { USER_POLICY } from '@kernel/policies/user.policy';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isSerializationConflict } from '@app/db/serialization-conflict';
import { isP2002 } from '@app/db/prisma-error';
import { PairingLimitExceededRollback } from './pairing-rollback.helper';
import {
  type PairRequestResult,
  resolvePairRequestAfterUniqueRace,
  isRapidPairReassert,
  lostPairRequestResult,
} from './pair-request.result';
import {
  CLEARED_PAIR_REQUEST_CONTEXT,
  pairRequestContextWrite,
} from '../pair-request.context';
import { pairRequestCrmNoteWrite } from '../pair-request-crm-note';

export { cancelPairRequest_IO } from './pair-request.cancel';

/**
 * A connection request from a standing QR code or a public profile. The client
 * creates a PENDING pair with no access (every path filters status ACTIVE), and
 * the stylist lifts it to ACTIVE in one tap (respondPairRequest_IO). Pair caps
 * are not checked on the request: PENDING takes no slot. Both caps are guarded
 * at ACCEPT, the same as claim. Anti-spam is the endpoint rate limit plus
 * uniqueness of (client, stylist).
 */
export const createPairRequest_IO = async (input: {
  client_user_id: string;
  stylist_account_id: string;
  place?: string | null;
  note?: string | null;
  retryAfterContactRace?: boolean;
}): Promise<PairRequestResult> => {
  const {
    client_user_id,
    stylist_account_id,
    place,
    note,
    retryAfterContactRace = true,
  } = input;
  const context = pairRequestContextWrite(place, note);
  try {
    return await DB_CLIENT.use.$transaction(async tx => {
      const stylistAccount = await tx.stylistAccount.findUnique({
        where: { account_id: stylist_account_id },
        select: {
          display_name: true,
          created_by_user_id: true,
          account_status: true,
          // Fields for the "request waiting" mail (emitInfoEvent in the endpoint).
          // They do not go into the client's response. The stylist's PII stays on the server.
          created_by_user: {
            select: { email: true, name: true, is_active: true },
          },
        },
      });

      // Anti-oracle, same as claim: a missing, inactive or own stylist (a
      // dual-role self-pair) is one NOT_FOUND, with nothing leaked.
      // is_active is checked explicitly, not via the cascade. Soft-delete and
      // disable set account_status in the same transaction today, so the gate
      // above would also fire, but that is a coincidence, not the contract.
      // ACCEPT in respondPairRequest_IO and the request list check account
      // liveness directly. If a path ever disabled a user without touching
      // account status, the request still would not reach a dead recipient
      // and would not mail them.
      if (
        !stylistAccount ||
        !USER_POLICY.utils.IS_ACCOUNT_STATUS_ACTIVE(
          stylistAccount.account_status
        ) ||
        stylistAccount.created_by_user.is_active === false ||
        stylistAccount.created_by_user_id === client_user_id
      ) {
        return failure({
          type: 'PAIR_REQUEST_STYLIST_NOT_FOUND',
          stylistAccountId: stylist_account_id,
        });
      }

      const existing = await tx.clientStylistPair.findUnique({
        where: {
          client_user_id_stylist_account_id: {
            client_user_id,
            stylist_account_id,
          },
        },
        select: {
          id: true,
          status: true,
          revoked_by: true,
          // Time of the PREVIOUS request (see the reassert-window DECISION below).
          paired_at: true,
          last_pair_request_at: true,
          // Hide = mute: if the stylist hid this conversation a repeated request sends her no mail (see `notify` below).
          stylist_hidden_at: true,
        },
      });

      // ACTIVE means already connected (the client scans a salon she is already
      // paired with). PENDING means the request is already waiting. paired_at
      // is not refreshed, so repeated requests do not bump list position.
      if (existing?.status === PairingStatusValue.ACTIVE) {
        return success({
          status: 'ALREADY_PAIRED' as const,
          display_name: stylistAccount.display_name,
          created: false,
          pair_id: existing.id,
          notify: null,
        });
      }
      if (existing?.status === PairingStatusValue.PENDING) {
        return success({
          status: 'PENDING' as const,
          display_name: stylistAccount.display_name,
          created: false,
          pair_id: existing.id,
          notify: null,
        });
      }

      if (existing) {
        // DECISION: a stylist-side revoke is IRREVERSIBLE for the client. Re-requesting used to lift every
        // REVOKED row back to PENDING, and `canSendToPair` allows PENDING, so a removed client regained the right
        // to write to the stylist's inbox, in the same thread, with one POST (confirmed live: revoke -> 403 on a
        // message -> request-pair -> 201, in a loop). "Remove this person" is the stylist's only control over who
        // contacts her. DECLINE behaved the same and each turn re-armed the "request waiting" mail. Re-pairing
        // stays possible only with the stylist's CONSENT, by scanning her code (session claim), never
        // unilaterally. The answer is masked as the same NOT_FOUND as a missing or inactive stylist (the client
        // cannot tell whether she was removed or the account vanished), like the gate above. revoked_by = NULL
        // rows predate the column and are treated like a client-side revoke so existing relations are not
        // retroactively blocked.
        if (
          existing.status === PairingStatusValue.REVOKED &&
          existing.revoked_by === AccountTypeValue.STYLIST
        ) {
          return failure({
            type: 'PAIR_REQUEST_STYLIST_NOT_FOUND',
            stylistAccountId: stylist_account_id,
          });
        }

        const isRapidReassert = isRapidPairReassert(existing);
        const requestTime = new Date();

        const flipped = await tx.clientStylistPair.updateMany({
          where: { id: existing.id, status: existing.status },
          data: {
            status: PairingStatusValue.PENDING,
            ...(isRapidReassert
              ? {}
              : { paired_at: requestTime, last_pair_request_at: requestTime }),
            ...context,
          },
        });
        if (flipped.count === 0) {
          const current = await tx.clientStylistPair.findUnique({
            where: { id: existing.id },
            select: { status: true },
          });
          return lostPairRequestResult(
            current?.status,
            existing.id,
            stylistAccount.display_name,
            stylist_account_id
          );
        }
        if (isRapidReassert) {
          return success({
            status: 'PENDING' as const,
            display_name: stylistAccount.display_name,
            created: false,
            pair_id: existing.id,
            notify: null,
          });
        }

        // DECISION: HIDE = MUTE. A stylist who HID this conversation gets no mail about a repeated request (the
        // stylist_hidden_at marker survives the REVOKED -> PENDING transition, so a re-request does not reveal the
        // thread). `created` and the client's response stay identical (anti-oracle: she cannot learn she was
        // muted). The request itself is real: it returns to the pending list after "Przywróć" in the inbox.
        return success({
          status: 'PENDING' as const,
          display_name: stylistAccount.display_name,
          created: true,
          pair_id: existing.id,
          notify:
            existing.stylist_hidden_at != null
              ? null
              : {
                  stylist_user_id: stylistAccount.created_by_user_id,
                  stylist_email: stylistAccount.created_by_user.email,
                  stylist_name: stylistAccount.created_by_user.name,
                },
        });
      }

      const requestTime = new Date();
      const createdPair = await tx.clientStylistPair.create({
        data: {
          client_user_id,
          stylist_account_id,
          status: PairingStatusValue.PENDING,
          paired_at: requestTime,
          last_pair_request_at: requestTime,
          ...context,
        },
        select: { id: true },
      });

      return success({
        status: 'PENDING' as const,
        display_name: stylistAccount.display_name,
        created: true,
        pair_id: createdPair.id,
        notify: {
          stylist_user_id: stylistAccount.created_by_user_id,
          stylist_email: stylistAccount.created_by_user.email,
          stylist_name: stylistAccount.created_by_user.name,
        },
      });
    });
  } catch (error) {
    // Wyścig dwóch PIERWSZYCH próśb tej samej pary (dwa urządzenia / HTTP
    // retry): przegrany create łapie unique-violation — to idempotentny
    // sukces, nie 500 (Codex #2; wzorzec session-container P2002).
    if (isP2002(error)) {
      return resolvePairRequestAfterUniqueRace({
        client_user_id,
        stylist_account_id,
        ...(retryAfterContactRace
          ? {
              onContact: () =>
                createPairRequest_IO({
                  ...input,
                  retryAfterContactRace: false,
                }),
            }
          : {}),
      });
    }
    return databaseFailure('createPairRequest_IO', error);
  }
};

/**
 * The stylist's response to a PENDING request. ACCEPT = PENDING -> ACTIVE under the FULL checks of both caps
 * (client platform cap + stylist plan cap) in a Serializable transaction, the same hard guard as the session
 * code claim (count() is the SSI serialization point; concurrent accepts over the cap abort with P2034 ->
 * 403). DECLINE = the row UNCONDITIONALLY returns to REVOKED (crm_note and the messenger thread survive, same
 * as read-only history; see the DECLINE branch).
 */
export const respondPairRequest_IO = async ({
  stylist_account_id,
  stylist_user_id,
  stylist_pricing_plan,
  pair_id,
  action,
}: {
  stylist_account_id: string;
  stylist_user_id: string;
  stylist_pricing_plan: PricingPlan;
  pair_id: string;
  action: 'ACCEPT' | 'DECLINE';
}): Promise<
  OperationResult<
    { success: true; status: 'ACTIVE' | 'DECLINED'; client_user_id: string },
    | PairRequestNotFoundError
    | PairingLimitReachedError
    | PairingTooManyActiveSessionsError
    | DatabaseError
  >
> => {
  try {
    const planConfig = await getPlanConfig(stylist_pricing_plan);
    const locales =
      action === 'ACCEPT'
        ? await batchResolveLocales([stylist_user_id])
        : undefined;
    const stylistLocale = getLocaleOrDefault(locales?.get(stylist_user_id));

    return await DB_CLIENT.use.$transaction(
      async tx => {
        // Ownership + state in ONE condition (anti-oracle): a foreign request, a missing row and a non-PENDING
        // status are the same NOT_FOUND.
        //
        // DECISION: ACCEPT and DECLINE are asymmetric on the client's liveness. ACCEPT requires
        // client_user.is_active=true: otherwise the stylist lifted to ACTIVE a pair with a client the API HIDES
        // from her (soft-delete DOMAIN_SSOT §13.1 or admin-disable; getPendingPairRequests_IO and getMyPairs_IO
        // filter is_active), i.e. an invisible pair eating a slot of both caps (see pairing-cap.predicates.ts). A
        // dead client collapses into the same PAIR_REQUEST_NOT_FOUND, so no "that account vanished" oracle.
        // DECLINE deliberately accepts such a row: the client can vanish BETWEEN rendering the request list and
        // the tap on "Odrzuć", and a refusal grants nothing (it only cleans up the request), so a 404 in that
        // race would only annoy the stylist.
        const pair = await tx.clientStylistPair.findFirst({
          where: {
            id: pair_id,
            stylist_account_id,
            status: PairingStatusValue.PENDING,
            ...(action === 'ACCEPT'
              ? { client_user: { is_active: true } }
              : {}),
          },
          select: {
            id: true,
            client_user_id: true,
            paired_at: true,
            crm_note: true,
            crm_note_updated_at: true,
            request_place: true,
            request_note: true,
          },
        });
        if (!pair) {
          return failure({ type: 'PAIR_REQUEST_NOT_FOUND', pairId: pair_id });
        }

        if (action === 'DECLINE') {
          // DECISION: a decline REVOKES the row and NEVER deletes it, same as cancelPairRequest_IO. The earlier
          // branch "revoked_at === null -> delete" removed the pair, and StylistClientMessage hangs on it with
          // onDelete: Cascade while the messenger is open already in PENDING, so one "Odrzuć" erased the whole
          // conversation for BOTH sides, without a trace or the client's consent. REVOKED keeps the thread as
          // read-only history (revoke retention model) and crm_note. revoked_by=STYLIST closes the loop: a
          // declined client cannot lift the row back to PENDING (see createPairRequest_IO); the way back is
          // only scanning the stylist's code.
          await tx.clientStylistPair.update({
            where: { id: pair.id },
            data: {
              status: PairingStatusValue.REVOKED,
              revoked_at: new Date(),
              revoked_by: AccountTypeValue.STYLIST,
              ...CLEARED_PAIR_REQUEST_CONTEXT,
            },
          });
          return success({
            success: true as const,
            status: 'DECLINED' as const,
            client_user_id: pair.client_user_id,
          });
        }

        // ACCEPT checks both caps, the same as claim. PENDING did not count toward
        // the limits, so the pair starts costing a slot on both sides only here.
        const clientPairingsCount = await tx.clientStylistPair.count({
          where: {
            client_user_id: pair.client_user_id,
            ...ACTIVE_PAIR_FOR_CAP,
          },
        });
        if (!PRICING_POLICY.utils.canPairStylist(clientPairingsCount)) {
          return failure({
            type: 'PAIRING_LIMIT_REACHED',
            currentCount: clientPairingsCount,
            limit: PRICING_POLICY.PLATFORM_LIMITS.MAX_PAIRED_STYLISTS,
            planType: 'PLATFORM',
          });
        }

        const stylistPairsCount = await tx.clientStylistPair.count({
          where: {
            stylist_account_id,
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
            planType: narrowPricingPlan(stylist_pricing_plan),
          });
        }

        // Atomic guard (wzorzec claim krok 3): WHERE powtarza wszystkie
        // race-loser predykaty — przegrany współbieżny accept/decline/claim
        // trafia count=0 → NOT_FOUND zamiast podwójnej aktywacji.
        const activatedAt = new Date();
        const updated = await tx.clientStylistPair.updateMany({
          where: {
            id: pair.id,
            stylist_account_id,
            status: PairingStatusValue.PENDING,
            // Also a lost race when the client disappeared after the read above.
            // ACCEPT never activates a pair whose other side is not visible.
            client_user: { is_active: true },
          },
          data: {
            status: PairingStatusValue.ACTIVE,
            salon_origin_account_id: null,
            paired_at: activatedAt,
            revoked_at: null,
            ...pairRequestCrmNoteWrite(pair, stylistLocale, activatedAt),
            ...CLEARED_PAIR_REQUEST_CONTEXT,
            // Symmetric with revoked_at and with the claim upsert: the pair is live
            // again, so the mark of the previous cut no longer applies. Leaving it
            // produced an ACTIVE row that still said the stylist had removed her.
            revoked_by: null,
          },
        });
        if (updated.count === 0) {
          return failure({ type: 'PAIR_REQUEST_NOT_FOUND', pairId: pair.id });
        }

        // Post-upsert backstop (parytet z claim 4.1): rollback gdy równoległe
        // accepty tej samej KLIENTKI przekroczyły platform-cap mimo pre-checku.
        const postCount = await tx.clientStylistPair.count({
          where: {
            client_user_id: pair.client_user_id,
            ...ACTIVE_PAIR_FOR_CAP,
          },
        });
        if (!PRICING_POLICY.utils.canPairStylist(postCount - 1)) {
          throw new PairingLimitExceededRollback(postCount);
        }

        await confirmLifecycleConnection(
          tx,
          stylist_account_id,
          stylist_user_id
        );

        return success({
          success: true as const,
          status: 'ACTIVE' as const,
          client_user_id: pair.client_user_id,
        });
      },
      { isolationLevel: 'Serializable' }
    );
  } catch (error) {
    if (error instanceof PairingLimitExceededRollback) {
      return failure({
        type: 'PAIRING_LIMIT_REACHED',
        currentCount: error.currentCount,
        limit: PRICING_POLICY.PLATFORM_LIMITS.MAX_PAIRED_STYLISTS,
        planType: 'PLATFORM',
      });
    }
    if (isSerializationConflict(error)) {
      // 40001 = przegrana tx SSI (rw-conflict), NIE dowód breachu capa —
      // retry przejdzie albo trafi w deterministyczny pre-check. Mapowanie na
      // PAIRING_LIMIT_REACHED dawało fałszywe, trwałe 403 „limit -1/-1"
      // (Codex #3). Parytet z claim: retryable 429 TOO_MANY.
      return failure({
        type: 'PAIRING_TOO_MANY_ACTIVE_SESSIONS',
        currentCount: -1,
        limit: -1,
      });
    }
    return databaseFailure('respondPairRequest_IO', error);
  }
};
