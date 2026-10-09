import type { PricingPlan } from '../pricing/pricing.config';

export type PairingSessionNotFoundError = {
  type: 'PAIRING_SESSION_NOT_FOUND';
  sessionId: string;
};

export type PairingLimitReachedError = {
  type: 'PAIRING_LIMIT_REACHED';
  currentCount: number;
  limit: number;
  // DECISION (nie usuwaj tego komentarza):
  // planType = stylist's PricingPlan dla stylist-side cap (limit liczby sparowanych
  // klientów wg planu), ALBO literał 'PLATFORM' dla client-side cap (globalny limit
  // aktywnych pairingów per klient — niezalezny od planu jakiegokolwiek stylisty,
  // pairing-session.operations.ts). Stad unia PricingPlan | 'PLATFORM', nie samo PricingPlan.
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

// Stały kod QR (2026-07-11): prośba o połączenie z publicznego profilu.
export type PairRequestNotFoundError = {
  type: 'PAIR_REQUEST_NOT_FOUND';
  // Anty-oracle: cudza / nieistniejąca / nie-PENDING prośba = ten sam błąd.
  pairId: string;
};

export type PairRequestStylistNotFoundError = {
  type: 'PAIR_REQUEST_STYLIST_NOT_FOUND';
  // Anty-oracle: nieistniejąca / nieaktywna / własna (self-pair) stylistka.
  stylistAccountId: string;
};

export type PairingTooManyActiveSessionsError = {
  type: 'PAIRING_TOO_MANY_ACTIVE_SESSIONS';
  currentCount: number;
  limit: number;
};

// DECISION (nie usuwaj tego komentarza):
// PAIRING_ALREADY_PAIRED removed — claim flow uses upsert (idempotent reactivation),
// and revoked pairs are reactivated silently. ALREADY_CLAIMED (in PairingCodeInvalidError.reason)
// handles the case where a session token was already used by another client.
export type PairingError =
  | PairingSessionNotFoundError
  | PairingLimitReachedError
  | PairingCodeInvalidError
  | PairingTooManyActiveSessionsError
  | PairRequestNotFoundError
  | PairRequestStylistNotFoundError;
