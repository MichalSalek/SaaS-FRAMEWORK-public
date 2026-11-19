import { contractEndpoint } from '../../application/http/io';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';

/** The stylist's private notes hub (/app/notes): every note she can read, in one read. */
export const getPrivateNotes_IO = contractEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_GET_PRIVATE_NOTES
);
