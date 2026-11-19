import { contractEndpoint } from '../../application/http/io';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';

/**
 * User Onboarding Operations
 *
 * Separated from userIO.possibilities.api.ts for clarity.
 * These are one-time operations that differ from regular user operations.
 * Onboarding flow is a distinct business process with different lifecycle.
 *
 * Every `_IO` returns `Promise<Res>` and hooks call it directly.
 */

export const onboardAsStylist_IO = contractEndpoint(
  USER_CONTRACTS.USER_ONBOARD_AS_STYLIST
);

export const onboardAsClient_IO = contractEndpoint(
  USER_CONTRACTS.USER_ONBOARD_AS_CLIENT
);

export const getAccountState_IO = contractEndpoint(
  USER_CONTRACTS.USER_GET_ACCOUNT_STATE
);

/**
 * Switch the active role (account_type) for a dual-role user. Backend
 * (switchRole_IO operation) auto-provisions the target account if missing and
 * reconciles the active role in the SAME session — front then refetches the BA
 * session so useAppRole re-derives the active dashboard. Contract:
 * REQUEST { account_type } → RESPONSE { success, account_type }.
 */
export const switchRole_IO = contractEndpoint(USER_CONTRACTS.USER_SWITCH_ROLE);
