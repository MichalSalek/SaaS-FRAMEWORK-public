import { TIME } from '@kernel/application/constants.config';
import { PAIRING_CONFIG } from '@domain/pairing/pairing.config';
import { DB_CLIENT } from '@app/db/db.client';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import {
  type OperationResult,
  success,
  failure,
} from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { PairRequestStylistNotFoundError } from '@kernel/domain/pairing/pairing-errors.types';

/**
 * Response shape of createPairRequest_IO, plus the read of the P2002 race winner.
 * Split out of pair-request.operations.ts because that file reached its max-lines
 * cap. Both pieces describe what the operation returns to the caller.
 */
export type PairRequestOutcome = {
  status: 'PENDING' | 'ALREADY_PAIRED';
  display_name: string | null;
  // True only when the request was actually created or reactivated. Audit and the
  // funnel counter (PAIR_REQUEST_SENT) count only created, so a repeat POST does
  // not count again.
  created: boolean;
  // Shared PostHog funnel key (sent, then accepted or declined).
  // Null only when even the re-read after the race could not load the row.
  pair_id: string | null;
  // Recipient of the "request waiting" mail. The endpoint consumes it when
  // created is true, on the standing QR path only. It is not part of the client DTO.
  notify: {
    stylist_user_id: string;
    stylist_email: string;
    stylist_name: string | null;
  } | null;
};

export type PairRequestResult = OperationResult<
  PairRequestOutcome,
  PairRequestStylistNotFoundError | DatabaseError
>;

/**
 * Answer for the loser of a race between two FIRST requests of the same pair (two devices / HTTP retry): the
 * unique violation is an idempotent success, not a 500.
 *
 * DECISION: the re-read by the unique key (client, stylist) is MANDATORY: without it the loser got
 * `pair_id: null` and `display_name: null`, so the UI had no handle to the request (cancel, shared PostHog
 * funnel key) and no salon name, although the winner had already written the row. It is one indexed read on a
 * path that happens only on a double POST. A failure of the re-read itself must not turn the idempotent
 * success into a 500, so the catch falls back to the variant without ids instead of propagating.
 */
export const resolvePairRequestAfterUniqueRace = async ({
  client_user_id,
  stylist_account_id,
  onContact,
}: {
  client_user_id: string;
  stylist_account_id: string;
  onContact?: () => Promise<PairRequestResult>;
}): Promise<PairRequestResult> => {
  try {
    const winner = await DB_CLIENT.use.clientStylistPair.findUnique({
      where: {
        client_user_id_stylist_account_id: {
          client_user_id,
          stylist_account_id,
        },
      },
      select: {
        id: true,
        status: true,
        stylist_account: { select: { display_name: true } },
      },
    });
    if (winner) {
      if (winner.status === PairingStatusValue.CONTACT && onContact) {
        return onContact();
      }
      if (
        winner.status === PairingStatusValue.CONTACT ||
        winner.status === PairingStatusValue.REVOKED
      ) {
        return failure({
          type: 'PAIR_REQUEST_STYLIST_NOT_FOUND',
          stylistAccountId: stylist_account_id,
        });
      }
      return success({
        // The winner creates PENDING. ACTIVE is reachable only when a code claim
        // lifted the pair immediately after. Map it like the re-read after a lost CAS.
        status:
          winner.status === PairingStatusValue.ACTIVE
            ? ('ALREADY_PAIRED' as const)
            : ('PENDING' as const),
        display_name: winner.stylist_account.display_name,
        created: false,
        pair_id: winner.id,
        notify: null,
      });
    }
  } catch {
    // See the DECISION above: a missing re-read degrades the response, it does not break it.
  }

  return success({
    status: 'PENDING' as const,
    display_name: null,
    created: false,
    pair_id: null,
    notify: null,
  });
};

export const isRapidPairReassert = (pair: {
  status: string;
  paired_at: Date | null;
  last_pair_request_at?: Date | null;
}): boolean => {
  const anchor =
    pair.status === PairingStatusValue.REVOKED
      ? pair.paired_at
      : pair.status === PairingStatusValue.CONTACT
        ? pair.last_pair_request_at
        : null;
  return (
    anchor != null &&
    Date.now() - anchor.getTime() <
      PAIRING_CONFIG.REQUEST_REASSERT_WINDOW_MINUTES * TIME.MS_PER_MINUTE
  );
};

/** A lost compare-and-set must not claim CONTACT or REVOKED is PENDING. */
export function lostPairRequestResult(
  status: string | undefined,
  pairId: string,
  displayName: string | null,
  stylistAccountId: string
): PairRequestResult {
  if (
    status !== PairingStatusValue.ACTIVE &&
    status !== PairingStatusValue.PENDING
  ) {
    return failure({
      type: 'PAIR_REQUEST_STYLIST_NOT_FOUND',
      stylistAccountId,
    });
  }
  return success({
    status: status === PairingStatusValue.ACTIVE ? 'ALREADY_PAIRED' : 'PENDING',
    display_name: displayName,
    created: false,
    pair_id: pairId,
    notify: null,
  });
}
