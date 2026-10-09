import { defineEndpoint } from '../../application/http/io';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';

// FDX FAZA 2 (W2.2/W2.3): domena `user` zmigrowana na unified promise-first
// front-door (`defineEndpoint`). Każdy `_IO` zwraca teraz `Promise<Res>` — hooki
// wołają go bezpośrednio (bez `toPromise` przy call-site). Side-effecty po
// odpowiedzi (cache-patch, redirect) przeniesione do TanStack Query callbacks
// w hookach — patrz DECISION w `application/http/io.ts`. Nazwy `_IO` zachowane.

export const changeUserName_IO = defineEndpoint<
  USER_DTO_API_V1['USER_CHANGE_NAME']['REQUEST'],
  USER_DTO_API_V1['USER_CHANGE_NAME']['RESPONSE'],
  USER_DTO_API_V1['USER_CHANGE_NAME']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.USER_CHANGE_NAME,
  mode: 'post',
});

// DECISION (nie usuwaj tego komentarza):
// requestEmailChange_IO posts to /api/v1/user/change-email (backend handler uses
// USER_REQUEST_EMAIL_CHANGE event). Po F2 dedup USER_CHANGE_EMAIL nie istnieje jako CQRS event;
// endpoint dostępny via ENDPOINTS.USER_REQUEST_EMAIL_CHANGE (alias → ROUTES_API.USER_CHANGE_EMAIL URL).
export const changeEmail_IO = defineEndpoint<
  USER_DTO_API_V1['USER_REQUEST_EMAIL_CHANGE']['REQUEST'],
  USER_DTO_API_V1['USER_REQUEST_EMAIL_CHANGE']['RESPONSE'],
  USER_DTO_API_V1['USER_REQUEST_EMAIL_CHANGE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.USER_REQUEST_EMAIL_CHANGE,
  mode: 'post',
});

// DECISION (nie usuwaj tego komentarza):
// Analogicznie po F2 dedup: USER_DELETE_SELF nie jest CQRS eventem (backend handler
// uses USER_REQUEST_DELETE). URL `/api/v1/user/delete/self` dostępny via
// ENDPOINTS.USER_REQUEST_DELETE (alias → ROUTES_API.USER_DELETE_SELF URL).
// Side-effect: redirect po sukcesie przeniesiony do hooka useDeleteSelf onSuccess
// (FAZA 2). Backend zwraca event USER_DELETE_REQUESTED (nie w REDIRECTIONS_ON_EVENTS)
// → redirectToByEvent jest no-opem; zachowanie 1:1 (page pokazuje ekran "done").
export const deleteUserSelf_IO = defineEndpoint<
  USER_DTO_API_V1['USER_REQUEST_DELETE']['REQUEST'],
  USER_DTO_API_V1['USER_REQUEST_DELETE']['RESPONSE'],
  USER_DTO_API_V1['USER_REQUEST_DELETE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.USER_REQUEST_DELETE,
  mode: 'post',
});

// Side-effect: redirect HOME po sukcesie przeniesiony do hooka useDisableUserSelf
// onSuccess (FAZA 2). Backend zwraca event USER_DISABLED_SELF → REDIRECTIONS_ON_EVENTS
// mapuje na HOME → redirect realnie następuje. Zachowanie 1:1.
export const disableUserSelf_IO = defineEndpoint<
  USER_DTO_API_V1['USER_DISABLE_SELF']['REQUEST'],
  USER_DTO_API_V1['USER_DISABLE_SELF']['RESPONSE'],
  USER_DTO_API_V1['USER_DISABLE_SELF']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.USER_DISABLE_SELF,
  mode: 'post',
});

// FDX FAZA 2 (W2.1 pilot): migrated to the unified promise-first front-door.
// `getUserUsageStats_IO` now returns `Promise<Res>` directly (no `toPromise`
// wrapper needed at the call site). Pattern for the rest of FAZA 2.
export const getUserUsageStats_IO = defineEndpoint<
  USER_DTO_API_V1['USER_GET_USAGE_STATS']['REQUEST'],
  USER_DTO_API_V1['USER_GET_USAGE_STATS']['RESPONSE'],
  USER_DTO_API_V1['USER_GET_USAGE_STATS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.USER_GET_USAGE_STATS,
  mode: 'get',
});

// DECISION (nie usuwaj tego komentarza):
// ADRR Model A (§13.1) superseded the email-based recovery flow on the frontend.
// `checkRecovery_IO` (POST /user/check-recovery) and `restoreAccount_IO`
// (POST /user/restore-account, legacy JSON restore) were removed — recovery is
// now POST-login and state-driven: the app reads is_active/deleted_at/
// recovery_available from SafeCurrentUser (GET /session/get-current) and calls
// `reactivateAccount_IO` below. The backend endpoints + kernel DTO entries
// (CHECK_RECOVERY / RESTORE_ACCOUNT, owned by B1) stay for legacy/anti-enumeration;
// they simply have no frontend caller anymore.

// ADRR Model A (§13.1) — reactivate own soft-deleted (RECOVERABLE) account
// in-place. POST, auth required, empty body (userId derived from session).
// On success the account flips back to ACTIVE (is_active=true, deleted_at=null,
// recovery_available=false); caller invalidates queryKeys.account.current so the
// app shell re-reads ACTIVE state and the recovery guard stops redirecting.
export const reactivateAccount_IO = defineEndpoint<
  USER_DTO_API_V1['USER_REACTIVATE_ACCOUNT']['REQUEST'],
  USER_DTO_API_V1['USER_REACTIVATE_ACCOUNT']['RESPONSE'],
  USER_DTO_API_V1['USER_REACTIVATE_ACCOUNT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.USER_REACTIVATE_ACCOUNT,
  mode: 'post',
});

// ADRR Model A (§13.1) — GDPR Art. 17 permanent erasure on explicit request.
// POST, auth required, empty body. The ONLY path to actual hard-delete. After
// success the caller signs the user out (record is gone — session is invalid).
export const gdprEraseAccount_IO = defineEndpoint<
  USER_DTO_API_V1['USER_GDPR_ERASE']['REQUEST'],
  USER_DTO_API_V1['USER_GDPR_ERASE']['RESPONSE'],
  USER_DTO_API_V1['USER_GDPR_ERASE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.USER_GDPR_ERASE,
  mode: 'post',
});

export const exportUserData_IO = defineEndpoint<
  USER_DTO_API_V1['USER_EXPORT_DATA']['REQUEST'],
  USER_DTO_API_V1['USER_EXPORT_DATA']['RESPONSE'],
  USER_DTO_API_V1['USER_EXPORT_DATA']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.USER_EXPORT_DATA,
  mode: 'post',
});

export const updateNotificationPreferences_IO = defineEndpoint<
  USER_DTO_API_V1['USER_UPDATE_NOTIFICATION_PREFERENCES']['REQUEST'],
  USER_DTO_API_V1['USER_UPDATE_NOTIFICATION_PREFERENCES']['RESPONSE'],
  USER_DTO_API_V1['USER_UPDATE_NOTIFICATION_PREFERENCES']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.USER_UPDATE_NOTIFICATION_PREFERENCES,
  mode: 'post',
});
