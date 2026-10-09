// main/src/domain/email/emailIO.possibilities.api.ts
// IO functions for email-related endpoints.
// FDX FAZA 2 (W2.2/W2.3): zmigrowane na unified promise-first front-door
// (`defineEndpoint` / `defineQuery`). Każdy `_IO` zwraca teraz `Promise<Res>` —
// hooki wołają go bezpośrednio (bez `toPromise` przy call-site). Nazwy `_IO`
// zachowane. Side-effecty po odpowiedzi → TanStack Query callbacks w hookach
// (patrz DECISION w `application/http/io.ts`).

import { defineEndpoint, defineQuery } from '../../application/http/io';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import type { EMAIL_DTO_API_V1 } from '@kernel/models/email/email.dto';

/* ─── Email unsubscribe (public, token-verified) ─── */
// POST, not GET: the backend GET path is a pure 302 redirect to the branded
// frontend page (footer-link click), so the actual mutation goes through the
// POST body channel — same channel as RFC 8058 One-Click.
export const emailUnsubscribe_IO = defineEndpoint<
  EMAIL_DTO_API_V1['EMAIL_UNSUBSCRIBE']['REQUEST'],
  EMAIL_DTO_API_V1['EMAIL_UNSUBSCRIBE']['RESPONSE'],
  EMAIL_DTO_API_V1['EMAIL_UNSUBSCRIBE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.EMAIL_UNSUBSCRIBE,
  mode: 'post',
  // The unsubscribe page owns the whole feedback with its own error card
  // (expired/invalid link vs retryable failure); a global toast on top of it
  // said the same thing twice. The promise still rejects, so the card renders.
  errorFeedbackPolicy: 'background',
});

/* ─── Get email schedule (trial + cancel sequences) ─── */

export const getEmailSchedule_IO = defineEndpoint<
  EMAIL_DTO_API_V1['EMAIL_GET_SCHEDULE']['REQUEST'],
  EMAIL_DTO_API_V1['EMAIL_GET_SCHEDULE']['RESPONSE'],
  EMAIL_DTO_API_V1['EMAIL_GET_SCHEDULE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.EMAIL_GET_SCHEDULE,
  mode: 'get',
});

/* ─── Update email preferences (trial + marketing toggles) ─── */

export const updateEmailPreferences_IO = defineEndpoint<
  EMAIL_DTO_API_V1['EMAIL_UPDATE_PREFERENCES']['REQUEST'],
  EMAIL_DTO_API_V1['EMAIL_UPDATE_PREFERENCES']['RESPONSE'],
  EMAIL_DTO_API_V1['EMAIL_UPDATE_PREFERENCES']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.EMAIL_UPDATE_PREFERENCES,
  mode: 'post',
});

/* ─── Admin: get email history for any user ─── */
// Backend supports `?userId=` query string for admin override (admin guard).
// Default (no userId) returns currentUser's own history.
// Wider request type than DTO — DTO is `Record<string, never>` because backend
// keeps userId out of body for IDOR-safety reasons.
export type GetEmailHistoryRequest = {
  userId?: string | undefined;
  cursor?: string | undefined;
  take?: number | undefined;
};

export const getEmailHistory_IO = defineQuery<
  GetEmailHistoryRequest,
  EMAIL_DTO_API_V1['EMAIL_GET_HISTORY']['RESPONSE'],
  EMAIL_DTO_API_V1['EMAIL_GET_HISTORY']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.EMAIL_GET_HISTORY,
  queryFields: req => ({
    userId: req.userId,
    cursor: req.cursor,
    take: req.take,
  }),
});
