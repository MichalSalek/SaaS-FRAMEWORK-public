import { contractEndpoint } from '../../application/http/io';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';

// The `user` domain calls go through the kernel contract. Every `_IO` returns
// `Promise<Res>` and hooks call it directly. Side effects after the response
// (cache patch, redirect) live in the hooks' TanStack Query callbacks.

export const changeUserName_IO = contractEndpoint(
  USER_CONTRACTS.USER_CHANGE_NAME
);

// DECISION: requestEmailChange_IO posts to /api/v1/user/change-email. USER_CHANGE_EMAIL is not a
// CQRS event (the backend handler uses USER_REQUEST_EMAIL_CHANGE), so the contract key is
// USER_REQUEST_EMAIL_CHANGE.
export const changeEmail_IO = contractEndpoint(
  USER_CONTRACTS.USER_REQUEST_EMAIL_CHANGE
);

// DECISION: likewise USER_DELETE_SELF is not a CQRS event (the handler uses USER_REQUEST_DELETE),
// so `/api/v1/user/delete/self` is USER_REQUEST_DELETE. The redirect after success lives in the
// useDeleteSelf hook's onSuccess; the backend event USER_DELETE_REQUESTED is not in
// REDIRECTIONS_ON_EVENTS, so redirectToByEvent is a no-op and the page shows its "done" screen.
export const deleteUserSelf_IO = contractEndpoint(
  USER_CONTRACTS.USER_REQUEST_DELETE
);

// The redirect HOME after success lives in the useDisableUserSelf hook's onSuccess. The backend
// returns USER_DISABLED_SELF, which REDIRECTIONS_ON_EVENTS maps to HOME.
export const disableUserSelf_IO = contractEndpoint(
  USER_CONTRACTS.USER_DISABLE_SELF
);

export const getUserUsageStats_IO = contractEndpoint(
  USER_CONTRACTS.USER_GET_USAGE_STATS
);

// DECISION: recovery is POST-login and state-driven (DOMAIN_SSOT §13.1): the app reads
// is_active/deleted_at/recovery_available from SafeCurrentUser (GET /session/get-current) and calls
// `reactivateAccount_IO` below. The email-based check-recovery and restore-account endpoints stay
// on the backend for anti-enumeration, with no frontend caller.

// Account deletion model A (§13.1): reactivate own soft-deleted (RECOVERABLE) account
// in-place. POST, auth required, empty body (userId derived from session).
// On success the account flips back to ACTIVE (is_active=true, deleted_at=null,
// recovery_available=false); caller invalidates queryKeys.account.current so the
// app shell re-reads ACTIVE state and the recovery guard stops redirecting.
export const reactivateAccount_IO = contractEndpoint(
  USER_CONTRACTS.USER_REACTIVATE_ACCOUNT
);

export const gdprEraseAccount_IO = contractEndpoint(
  USER_CONTRACTS.USER_GDPR_ERASE
);

export const exportUserData_IO = contractEndpoint(
  USER_CONTRACTS.USER_EXPORT_DATA
);

export const updateNotificationPreferences_IO = contractEndpoint(
  USER_CONTRACTS.USER_UPDATE_NOTIFICATION_PREFERENCES
);

export const setUserAvatar_IO = contractEndpoint(
  USER_CONTRACTS.USER_SET_AVATAR
);
