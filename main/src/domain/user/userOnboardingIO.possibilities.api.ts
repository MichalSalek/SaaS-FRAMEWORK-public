import { defineEndpoint } from '../../application/http/io';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';

/**
 * User Onboarding Operations
 *
 * Separated from userIO.possibilities.api.ts for clarity.
 * These are one-time operations that differ from regular user operations.
 * Onboarding flow is a distinct business process with different lifecycle.
 *
 * FDX FAZA 2 (W2.3): zmigrowane na unified promise-first front-door (`defineEndpoint`).
 * Każdy `_IO` zwraca teraz `Promise<Res>` — hooki wołają go bezpośrednio
 * (bez `toPromise` przy call-site). Nazwy `_IO` zachowane.
 */

export const onboardAsStylist_IO = defineEndpoint<
  USER_DTO_API_V1['USER_ONBOARD_AS_STYLIST']['REQUEST'],
  USER_DTO_API_V1['USER_ONBOARD_AS_STYLIST']['RESPONSE'],
  USER_DTO_API_V1['USER_ONBOARD_AS_STYLIST']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.USER_ONBOARD_AS_STYLIST,
  mode: 'post',
});

export const onboardAsClient_IO = defineEndpoint<
  USER_DTO_API_V1['USER_ONBOARD_AS_CLIENT']['REQUEST'],
  USER_DTO_API_V1['USER_ONBOARD_AS_CLIENT']['RESPONSE'],
  USER_DTO_API_V1['USER_ONBOARD_AS_CLIENT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.USER_ONBOARD_AS_CLIENT,
  mode: 'post',
});

export const getAccountState_IO = defineEndpoint<
  USER_DTO_API_V1['USER_GET_ACCOUNT_STATE']['REQUEST'],
  USER_DTO_API_V1['USER_GET_ACCOUNT_STATE']['RESPONSE'],
  USER_DTO_API_V1['USER_GET_ACCOUNT_STATE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.USER_GET_ACCOUNT_STATE,
  mode: 'get',
});

/**
 * Switch the active role (account_type) for a dual-role user. Backend
 * (switchRole_IO operation) auto-provisions the target account if missing and
 * reconciles the active role in the SAME session — front then refetches the BA
 * session so useAppRole re-derives the active dashboard. Contract:
 * REQUEST { account_type } → RESPONSE { success, account_type }.
 */
export const switchRole_IO = defineEndpoint<
  USER_DTO_API_V1['USER_SWITCH_ROLE']['REQUEST'],
  USER_DTO_API_V1['USER_SWITCH_ROLE']['RESPONSE'],
  USER_DTO_API_V1['USER_SWITCH_ROLE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.USER_SWITCH_ROLE,
  mode: 'post',
});
