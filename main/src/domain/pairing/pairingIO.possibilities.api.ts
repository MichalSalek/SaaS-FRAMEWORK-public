import { contractEndpoint } from '../../application/http/io';
import { PAIRING_CONTRACTS } from '@kernel/domain/pairing/pairing.contracts';

// Every pairing call is derived from its kernel contract (URL, method, request and response).
// Per-call options (successFeedback, abort) stay on the promise function.
// Permanent codes only: the issue/claim/revoke clients for session codes were removed
// together with the generation UI; the backend endpoints stay as unexposed legacy.
const C = PAIRING_CONTRACTS;

export const pairingRevokeAccess = contractEndpoint(C.PAIRING_ACCESS_REVOKE);

export const pairingGetAccessStatus = contractEndpoint(
  C.PAIRING_GET_ACCESS_STATUS
);

export const pairingGetMyPairs = contractEndpoint(C.PAIRING_GET_MY_PAIRS);

// Permanent QR code: a connection request from the public profile (client), plus the reply and
// the list of PENDING requests (stylist).
export const pairRequestCreate = contractEndpoint(C.PAIR_REQUEST_CREATE);

export const pairRequestRespond = contractEndpoint(C.PAIR_REQUEST_RESPOND);

// The client withdraws her own PENDING request.
export const pairRequestCancel = contractEndpoint(C.PAIR_REQUEST_CANCEL);

export const pairingGetMyPendingRequests = contractEndpoint(
  C.PAIRING_GET_MY_PENDING_REQUESTS
);

export const pairingGetPendingRequests = contractEndpoint(
  C.PAIRING_GET_PENDING_REQUESTS
);
