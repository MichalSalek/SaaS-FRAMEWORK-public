import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';

/**
 * DECISION: caps count EVERY ACTIVE pair, also a "ghost" (a pair whose counterpart is soft-deleted or banned).
 * Filtering ghosts so that "counted" means "visible" frees a slot while the ACTIVE row still exists, so when
 * the counterpart RETURNS (one-click restore within the 90-day window, or un-ban) the pair counts again and the
 * account is permanently over its limit with nothing to reconcile it. Measured live: a FREE stylist (limit 2)
 * had 2 pairs, a client deleted her account, a third request was accepted, the client restored her account and
 * the FREE account held 3 pairs indefinitely, repeatably: a monetization gate bypassable from the client side.
 * The same holds for the client's platform cap and salon seats. So ghosts are counted and exceeding the limit
 * is impossible by construction. The cost is known: a ghost occupies a slot. It is closed by owner decision
 * (2026-09-05): such pairs ARE listed (stylist and client) as "Konto nieaktywne" with the identity masked
 * server-side (getMyPairs_IO, pairing-query.operations.ts) and a "Zwolnij miejsce" action that uses the
 * existing idempotent revoke-access path. Reconciliation on account restore was rejected, because it is what
 * produced the permanent overrun. A slot is freed ONLY by that explicit action or the terminal MOVE after 90
 * days (FK cascade). (owner)
 */
export const ACTIVE_PAIR_FOR_CAP = {
  status: PairingStatusValue.ACTIVE,
  salon_origin_account_id: null,
};
