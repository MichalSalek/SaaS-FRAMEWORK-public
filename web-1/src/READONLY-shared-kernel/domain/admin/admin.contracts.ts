import { ADMIN_COMMAND_A } from './admin-command-a.contracts';
import { ADMIN_COMMAND_B } from './admin-command-b.contracts';
import { ADMIN_QUERY_A } from './admin-query-a.contracts';
import { ADMIN_QUERY_B } from './admin-query-b.contracts';

/**
 * Admin endpoints. Access follows role-permissions.ts: SEND_LOG and the public flag
 * read sit in BASE (PUBLIC); switch-back and refresh sit in LOGGED_USER; every other
 * key is the admin wildcard. GET list filters are lenient: a bad value is dropped or
 * replaced by the fallback the handler already used. It is not a 400.
 */
export const ADMIN_CONTRACTS = Object.freeze({
  ...ADMIN_COMMAND_A,
  ...ADMIN_COMMAND_B,
  ...ADMIN_QUERY_A,
  ...ADMIN_QUERY_B,
});

export type AdminContracts = typeof ADMIN_CONTRACTS;
