import type { PricingPlan } from '../pricing/pricing.config';

export type PairingSessionNotFoundError = {
  type: 'PAIRING_SESSION_NOT_FOUND';
  sessionId: string;
};

export type PairingLimitReachedError = {
  type: 'PAIRING_LIMIT_REACHED';
  currentCount: number;
  limit: number;
  // DECISION: planType is the stylist's PricingPlan for the plan-based client cap, or the literal
  // 'PLATFORM' for the client-side cap (global active-pairing limit per client, independent of any
  // stylist's plan; pairing-session.operations.ts), hence the union.
  planType: PricingPlan | 'PLATFORM';
};

export type PairingCodeInvalidError = {
  type: 'PAIRING_CODE_INVALID';
  code: string;
  reason:
    | 'NOT_FOUND'
    | 'EXPIRED'
    | 'REVOKED'
    | 'ALREADY_CLAIMED'
    | 'STYLIST_INACTIVE';
};

// Connection request from the public profile.
export type PairRequestNotFoundError = {
  type: 'PAIR_REQUEST_NOT_FOUND';
  // Anti-oracle: someone else's / nonexistent / non-PENDING request = the same error.
  pairId: string;
};

export type PairRequestStylistNotFoundError = {
  type: 'PAIR_REQUEST_STYLIST_NOT_FOUND';
  // Anti-oracle: nonexistent / inactive / own (self-pair) stylist.
  stylistAccountId: string;
};

export type PairingTooManyActiveSessionsError = {
  type: 'PAIRING_TOO_MANY_ACTIVE_SESSIONS';
  currentCount: number;
  limit: number;
};

// DECISION: there is no PAIRING_ALREADY_PAIRED: the claim flow upserts (revoked pairs are
// reactivated silently); a session token already used by another client is reported as
// PairingCodeInvalidError.reason ALREADY_CLAIMED.
export type PairingError =
  | PairingSessionNotFoundError
  | PairingLimitReachedError
  | PairingCodeInvalidError
  | PairingTooManyActiveSessionsError
  | PairRequestNotFoundError
  | PairRequestStylistNotFoundError;
