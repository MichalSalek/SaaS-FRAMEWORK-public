// application/auth/identity-switch.ts
// Admin identity switch (become-user / switch-back): where to go afterwards and
// how to get there.
//
// DECISION (nie usuwaj tego komentarza):
// Every identity switch ends with a FULL DOCUMENT LOAD, never a client-side
// route change. The in-memory state of this SPA is keyed to one identity in at
// least four places that do not listen to the token in storage: the Better Auth
// `useSession()` atom (its /get-session path is outside the $sessionSignal
// matcher, so nothing refetches it), the TanStack Query cache, `AuthContext`
// and the Zustand stores. Swapping the token and pushing a route (the previous
// flow) left the admin's session in the atom: `/app` rendered the MOBILE ADMIN
// dashboard for the impersonated stylist and fired admin/health + admin/metrics
// with her token → 403 toasts; switching back mixed both identities on one
// screen (admin avatar, her greeting) and never reached the users list. A reload
// resets all four at once, and no future store can reintroduce the leak.
// Tokens are already persisted by the HTTP header interceptor BEFORE the
// success callback runs (http.possibilities.api → interceptors.headers first),
// and the become-user token lives in sessionStorage, which survives a reload
// of the same tab (WebView included).

import {
  REDIRECTIONS_ON_EVENTS,
  ROUTES_FRONT,
  ROUTES_FRONT_APP,
} from '@kernel/domain/routing/routing.config';
import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
import { clearAuthChannelTokens } from './auth-token-teardown';
import {
  deleteFromClientStorage,
  getFromClientStorage,
  setToClientStorage,
} from '../client-device-storage/clientStorage.possibilities.api';
import { STORAGE_KEYS } from '../client-device-storage/storage-keys.config';
import { bypassLeaveGuard } from '../routing/leave-guard';

/** Where switch-back lands when no valid return address was remembered. */
export const IMPERSONATION_RETURN_FALLBACK: string =
  REDIRECTIONS_ON_EVENTS.USER_SWITCHED_BACK_TO_SELF ??
  ROUTES_FRONT_APP.ADMIN_USERS;

/**
 * A return address is accepted only when it is a same-origin path inside the
 * admin panel. Storage is writable by any script on the origin, so the value is
 * treated as untrusted: no scheme, no protocol-relative `//`, no backslash
 * (browsers normalise `\` to `/`), no control characters.
 */
export const resolveImpersonationReturnUrl = (raw: string | null): string => {
  if (raw === null) {
    return IMPERSONATION_RETURN_FALLBACK;
  }
  const value = raw.trim();
  const adminRoot = ROUTES_FRONT_APP.ADMIN;
  // Next prefixes every non-default locale (/en/app/admin/…); the admin works
  // in any language, so the prefix is part of a valid return address.
  const localePrefix = I18N_CONFIG.locales.find(
    locale => value === `/${locale}` || value.startsWith(`/${locale}/`)
  );
  const path =
    localePrefix === undefined ? value : value.slice(localePrefix.length + 1);
  const isInsideAdmin =
    path === adminRoot ||
    path.startsWith(`${adminRoot}/`) ||
    path.startsWith(`${adminRoot}?`);
  const hasUnsafeChars =
    value.includes('\\') ||
    Array.from(value).some(ch => {
      const code = ch.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    });
  if (!isInsideAdmin || value.startsWith('//') || hasUnsafeChars) {
    return IMPERSONATION_RETURN_FALLBACK;
  }
  return value;
};

/** Remember the admin screen (path + query) the impersonation started from. */
export const rememberImpersonationReturnUrl = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  const current = `${window.location.pathname}${window.location.search}`;
  const accepted = resolveImpersonationReturnUrl(current);
  setToClientStorage({
    key: STORAGE_KEYS.IMPERSONATION_RETURN_URL,
    value: accepted,
    sessionOnly: true,
  });
};

/** Read and forget the remembered admin screen (validated, never empty). */
export const consumeImpersonationReturnUrl = (): string => {
  const raw = getFromClientStorage({
    key: STORAGE_KEYS.IMPERSONATION_RETURN_URL,
  });
  deleteFromClientStorage({ key: STORAGE_KEYS.IMPERSONATION_RETURN_URL });
  return resolveImpersonationReturnUrl(raw);
};

/** Full document load — see the DECISION at the top of this file. */
export const reloadIntoIdentity = (path: string): void => {
  if (typeof window === 'undefined') {
    return;
  }
  // The tokens are already swapped: a beforeunload prompt from a leave guard
  // (upload, admin editors) would cancel the load and leave the page running
  // as the previous identity over the new token (leave-guard.ts).
  bypassLeaveGuard();
  window.location.assign(path);
};

/**
 * The server refused to restore the admin (e.g. the impersonation backup
 * expired): the impersonated session cannot be turned back into the admin one,
 * and retrying only repeats the refusal while the admin stays inside someone
 * else's account (S122 review). Drop both token channels and reload into the
 * login page, which returns to the remembered admin screen after sign-in.
 */
export const abandonImpersonationToLogin = (): void => {
  const returnUrl = consumeImpersonationReturnUrl();
  clearAuthChannelTokens();
  reloadIntoIdentity(
    `${ROUTES_FRONT.USER_LOG}?from=${encodeURIComponent(returnUrl)}`
  );
};
