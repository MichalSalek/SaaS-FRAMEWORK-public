import { contractEndpoint } from '../../application/http/io';
import { CLIENT_CONTRACTS } from '@kernel/domain/client/client.contracts';

// Profile and contact calls are derived from the kernel contract (URL, method, request
// and response). The `_IO` names are kept. No per-call options on these three.
const C = CLIENT_CONTRACTS;

export const updateClientContact_IO = contractEndpoint(C.CLIENT_UPDATE_CONTACT);
export const getClientProfile_IO = contractEndpoint(C.CLIENT_GET_PROFILE);
export const getClientContactForStylist_IO = contractEndpoint(
  C.CLIENT_GET_CONTACT_FOR_STYLIST
);
