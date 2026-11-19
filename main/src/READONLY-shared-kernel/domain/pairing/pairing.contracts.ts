import { defineContracts } from '../../application/contracts/contract.types';
import { QUERY_FIELD } from '../../application/contracts/query-fields';
import {
  accessStatusSchema,
  cancelRequestSchema,
  claimedSessionSchema,
  emptyCommandBody,
  issuedSessionSchema,
  myPairsSchema,
  myPendingRequestsSchema,
  pairRequestCancelSchema,
  pairRequestCreateSchema,
  pairRequestCreatedSchema,
  pairRequestRespondedSchema,
  pairRequestRespondSchema,
  pairingClaimSessionSchema,
  pairingRevokeAccessSchema,
  pairingRevokeSessionSchema,
  pairingResolvePlaceResponseSchema,
  pairingResolvePlaceSchema,
  pendingRequestsSchema,
  revokedCountSchema,
  revokeSuccessSchema,
} from './pairing.contract-schemas';

/**
 * Pairing endpoints. Command bodies are the schemas the kernel validators already
 * enforced. GET filters stay lenient: a bad value is dropped or falls back, it is
 * not a 400, except a missing stylist account id, which the handler still rejects
 * with `{ stylist_account_id: 'Required' }`.
 */

const pairsPage = {
  cursor: QUERY_FIELD.string(),
  take: QUERY_FIELD.int(50),
};

const stylistAccountQuery = {
  stylist_account_id: QUERY_FIELD.requiredString(),
};

export const PAIRING_CONTRACTS = defineContracts({
  PAIRING_SESSION_ISSUE: {
    summary:
      'Stylistka wystawia jednorazowy kod połączenia z terminem ważności.',
    group: 'PAIRING',
    kind: 'COMMAND',
    path: 'pairing/issue-session',
    method: 'POST',
    body: emptyCommandBody,
    query: null,
    response: issuedSessionSchema,
    successEvents: ['PAIRING_SESSION_ISSUED'],
    auditEvents: ['PAIRING_SESSION_ISSUED'],
    access: 'STYLIST',
    authCheck: true,
    limiterTier: 'strict',
  },

  PAIRING_SESSION_CLAIM: {
    summary:
      'Klientka realizuje kod połączenia i łączy swoje konto ze stylistką.',
    group: 'PAIRING',
    kind: 'COMMAND',
    path: 'pairing/claim-session',
    method: 'POST',
    body: pairingClaimSessionSchema,
    query: null,
    response: claimedSessionSchema,
    successEvents: ['PAIRING_SESSION_CLAIMED'],
    auditEvents: ['PAIRING_SESSION_CLAIMED'],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'strict',
  },

  PAIRING_SESSION_REVOKE: {
    summary: 'Stylistka unieważnia jeden kod połączenia.',
    group: 'PAIRING',
    kind: 'COMMAND',
    path: 'pairing/revoke-session',
    method: 'POST',
    body: pairingRevokeSessionSchema,
    query: null,
    response: revokeSuccessSchema,
    successEvents: ['PAIRING_SESSION_REVOKED'],
    auditEvents: ['PAIRING_SESSION_REVOKED'],
    access: 'STYLIST',
    authCheck: true,
    limiterTier: 'default',
  },

  PAIRING_SESSION_REVOKE_ALL: {
    summary:
      'Stylistka unieważnia wszystkie swoje aktywne kody połączenia. Zwraca liczbę unieważnionych.',
    group: 'PAIRING',
    kind: 'COMMAND',
    path: 'pairing/revoke-all-sessions',
    method: 'POST',
    body: emptyCommandBody,
    query: null,
    response: revokedCountSchema,
    successEvents: ['ALL_PAIRING_SESSIONS_REVOKED'],
    auditEvents: ['ALL_PAIRING_SESSIONS_REVOKED'],
    access: 'STYLIST',
    authCheck: true,
    limiterTier: 'default',
  },

  PAIRING_ACCESS_REVOKE: {
    summary:
      'Klientka albo stylistka zrywa połączenie. Cel to użytkowniczka albo konto.',
    group: 'PAIRING',
    kind: 'COMMAND',
    path: 'pairing/revoke-access',
    method: 'POST',
    body: pairingRevokeAccessSchema,
    query: null,
    response: revokeSuccessSchema,
    successEvents: ['PAIRING_ACCESS_REVOKED'],
    auditEvents: ['PAIRING_ACCESS_REVOKED'],
    access: 'STYLIST_AND_CLIENT',
    authCheck: true,
    limiterTier: 'default',
  },

  PAIRING_GET_ACCESS_STATUS: {
    summary:
      'Status dostępu klientki do wizytówki stylistki: publiczny, połączona lub prośba czeka.',
    group: 'PAIRING',
    kind: 'QUERY',
    path: 'pairing/get-access-status',
    method: 'GET',
    body: null,
    query: stylistAccountQuery,
    response: accessStatusSchema,
    successEvents: ['PAIRING_ACCESS_STATUS_FETCHED'],
    auditEvents: [],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'default',
  },

  PAIRING_GET_MY_PAIRS: {
    summary:
      'Stronicowana lista aktywnych połączeń. Strona po stronie, domyślnie 50.',
    group: 'PAIRING',
    kind: 'QUERY',
    path: 'pairing/get-my-pairs',
    method: 'GET',
    body: null,
    query: pairsPage,
    response: myPairsSchema,
    successEvents: ['PAIRING_PAIRS_FETCHED'],
    auditEvents: [],
    access: 'STYLIST_AND_CLIENT',
    authCheck: true,
    limiterTier: 'default',
  },

  PAIR_REQUEST_CREATE: {
    summary:
      'Klientka prosi o połączenie z profilu stylistki. Zwraca status i pair_id.',
    group: 'PAIRING',
    kind: 'COMMAND',
    path: 'pairing/request-pair',
    method: 'POST',
    body: pairRequestCreateSchema,
    query: null,
    response: pairRequestCreatedSchema,
    successEvents: ['PAIR_REQUEST_SENT'],
    auditEvents: ['PAIR_REQUEST_SENT'],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'strict',
  },

  PAIR_REQUEST_RESPOND: {
    summary: 'Stylistka akceptuje albo odrzuca prośbę o połączenie.',
    group: 'PAIRING',
    kind: 'COMMAND',
    path: 'pairing/respond-request',
    method: 'POST',
    body: pairRequestRespondSchema,
    query: null,
    response: pairRequestRespondedSchema,
    successEvents: ['PAIR_REQUEST_ACCEPTED', 'PAIR_REQUEST_DECLINED'],
    auditEvents: ['PAIR_REQUEST_ACCEPTED', 'PAIR_REQUEST_DECLINED'],
    access: 'STYLIST',
    authCheck: true,
    limiterTier: 'strict',
  },

  PAIR_REQUEST_CANCEL: {
    summary: 'Klientka wycofuje własną prośbę o połączenie.',
    group: 'PAIRING',
    kind: 'COMMAND',
    path: 'pairing/cancel-request',
    method: 'POST',
    body: pairRequestCancelSchema,
    query: null,
    response: cancelRequestSchema,
    successEvents: ['PAIR_REQUEST_CANCELLED'],
    auditEvents: ['PAIR_REQUEST_CANCELLED'],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'strict',
  },

  PAIRING_RESOLVE_PLACE: {
    summary:
      'Klientka zamienia przybliżone współrzędne na nazwę miejsca do prośby o połączenie.',
    group: 'PAIRING',
    kind: 'COMMAND',
    path: 'pairing/resolve-place',
    method: 'POST',
    body: pairingResolvePlaceSchema,
    query: null,
    response: pairingResolvePlaceResponseSchema,
    successEvents: ['SUCCESS'],
    auditEvents: [],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'strict',
  },

  PAIRING_GET_PENDING_REQUESTS: {
    summary:
      'Lista próśb oczekujących u stylistki (imię, zdjęcie, miejsce, wiadomość, czas).',
    group: 'PAIRING',
    kind: 'QUERY',
    path: 'pairing/pending-requests',
    method: 'GET',
    body: null,
    query: null,
    response: pendingRequestsSchema,
    successEvents: ['PENDING_REQUESTS_FETCHED'],
    auditEvents: [],
    access: 'STYLIST',
    authCheck: true,
    limiterTier: 'strict',
  },

  PAIRING_GET_MY_PENDING_REQUESTS: {
    summary:
      'Lista własnych próśb klientki, które czekają na akceptację stylistki.',
    group: 'PAIRING',
    kind: 'QUERY',
    path: 'pairing/my-pending-requests',
    method: 'GET',
    body: null,
    query: null,
    response: myPendingRequestsSchema,
    successEvents: ['PENDING_REQUESTS_FETCHED'],
    auditEvents: [],
    access: 'CLIENT',
    authCheck: true,
    limiterTier: 'strict',
  },
});

export type PairingContracts = typeof PAIRING_CONTRACTS;
