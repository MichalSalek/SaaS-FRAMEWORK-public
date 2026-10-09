// main/src/domain/salon-staff/salonStaffIO.possibilities.api.ts
// IO functions for salon staff management.
// FDX FAZA 2 (W2.2/W2.3): zmigrowane na unified promise-first front-door
// (`defineEndpoint` / `definePathEndpoint`). Każdy `_IO` zwraca teraz
// `Promise<Res>` lub `(pathParam) => Promise<Res>` — hooki wołają bezpośrednio
// (bez `toPromise` przy call-site). Nazwy `_IO` zachowane. Patrz DECISION w
// `application/http/io.ts`.

import { defineEndpoint, definePathEndpoint } from '../../application/http/io';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../application/routing/buildRoute';
import type { EndpointProps } from '../../application/http/http.endpoints';
import type { SALON_STAFF_DTO_API_V1 } from '@kernel/models/salon-staff/salon-staff.dto';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const apiBase = (props: EndpointProps): string => {
  const port = props.ENV_VARS.NEXT_PUBLIC_BACKEND_PUBLIC_PORT;
  return `${props.ENV_VARS.NEXT_PUBLIC_HTTP_PROTOCOL}${props.ENV_VARS.NEXT_PUBLIC_BACKEND_PUBLIC_DOMAIN}${port ? `:${port}` : ''}`;
};

// ─── Static endpoints (no path param) ────────────────────────────────────────

export const getSalonStaff_IO = defineEndpoint<
  SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_ALL']['REQUEST'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_ALL']['RESPONSE'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_ALL']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SALON_STAFF_GET_ALL,
  mode: 'get',
});

export const inviteSalonStaff_IO = defineEndpoint<
  SALON_STAFF_DTO_API_V1['SALON_STAFF_INVITE']['REQUEST'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_INVITE']['RESPONSE'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_INVITE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SALON_STAFF_INVITE,
  mode: 'post',
});

// ─── Invitee side (2026-09-25) ───────────────────────────────────────────────

/** The logged-in person's own pending salon-team invitations (any role). */
export const getMySalonInvitations_IO = defineEndpoint<
  SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_MY_INVITATIONS']['REQUEST'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_MY_INVITATIONS']['RESPONSE'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_MY_INVITATIONS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SALON_STAFF_GET_MY_INVITATIONS,
  mode: 'get',
});

/** The invited person accepts or declines one invitation. */
export const respondSalonInvitation_IO = defineEndpoint<
  SALON_STAFF_DTO_API_V1['SALON_STAFF_RESPOND_INVITATION']['REQUEST'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_RESPOND_INVITATION']['RESPONSE'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_RESPOND_INVITATION']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SALON_STAFF_RESPOND_INVITATION,
  mode: 'post',
});

// ─── Path-param endpoints (staffId in URL) ────────────────────────────────────

/**
 * Returns a promise-first IO function for PATCH /api/v1/salon/staff/[staffId]/update.
 * Usage: `updateSalonStaffPermissions_IO(staffId)(payload)`
 */
export const updateSalonStaffPermissions_IO = definePathEndpoint<
  SALON_STAFF_DTO_API_V1['SALON_STAFF_UPDATE_PERMISSIONS']['REQUEST'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_UPDATE_PERMISSIONS']['RESPONSE'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_UPDATE_PERMISSIONS']['RESPONSE_ERROR']
>(
  staffId => props =>
    `${apiBase(props)}${buildRoute(ROUTES_API.SALON_STAFF_UPDATE_PERMISSIONS, { staffId })}`,
  'patch'
);

/**
 * Returns a promise-first IO function for DELETE /api/v1/salon/staff/[staffId]/delete.
 * Usage: `removeSalonStaff_IO(staffId)(undefined)`
 */
export const removeSalonStaff_IO = definePathEndpoint<
  SALON_STAFF_DTO_API_V1['SALON_STAFF_REMOVE']['REQUEST'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_REMOVE']['RESPONSE'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_REMOVE']['RESPONSE_ERROR']
>(
  staffId => props =>
    `${apiBase(props)}${buildRoute(ROUTES_API.SALON_STAFF_REMOVE, { staffId })}`,
  'delete'
);

/**
 * Returns a promise-first IO function for GET /api/v1/salon/staff/[staffId].
 * Usage: `getSalonStaffById_IO(staffId)(undefined)`
 */
export const getSalonStaffById_IO = definePathEndpoint<
  SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_BY_ID']['REQUEST'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_BY_ID']['RESPONSE'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_BY_ID']['RESPONSE_ERROR']
>(
  staffId => props =>
    `${apiBase(props)}${buildRoute(ROUTES_API.SALON_STAFF_GET_BY_ID, { staffId })}`,
  'get'
);
