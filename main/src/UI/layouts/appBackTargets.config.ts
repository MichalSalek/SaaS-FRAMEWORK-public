// UI/layouts/appBackTargets.config.ts
// Where „Wróć” leads when the browser history has nowhere to go.
//
// DECISION: a sub-page opened from a link (e-mail, shared address, fresh tab)
// has an empty history, so `router.back()` is a no-op and the page had no way
// up. Every sub-page has a logical parent; back goes there only when history
// cannot. With history present back stays a real back.
//
// The map is by ROUTE PATTERN (Next `router.pathname`, so `[id]` segments are
// literal), longest prefix first. A route missing here falls back to the app
// home, which is always a valid place to land.

import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

const PARENT_BY_PREFIX: ReadonlyArray<
  readonly [prefix: string, parent: string]
> = [
  [`${ROUTES_FRONT.SUPPORT}/[threadId]`, ROUTES_FRONT.SUPPORT_THREADS],
  [`${ROUTES_FRONT.SUPPORT}/`, ROUTES_FRONT.SUPPORT],
  [`${ROUTES_FRONT.USER_ACCOUNT}/`, ROUTES_FRONT.USER_ACCOUNT],
  [ROUTES_FRONT.USER_ACTIVITY_LOG, ROUTES_FRONT.USER_ACCOUNT],
  [ROUTES_FRONT.USER_DEL_SELF, ROUTES_FRONT.USER_ACCOUNT],
  [ROUTES_FRONT.USER_ACTIVATE_CLIENT, ROUTES_FRONT.USER_ACCOUNT],
  [ROUTES_FRONT.USER_ACTIVATE_STYLIST, ROUTES_FRONT.USER_ACCOUNT],
  [`${ROUTES_FRONT.MESSAGES}/`, ROUTES_FRONT.MESSAGES],
  [`${ROUTES_FRONT.CLIENT_SESSIONS}/`, ROUTES_FRONT.CLIENT_SESSIONS],
  [ROUTES_FRONT.SESSION_DETAIL, ROUTES_FRONT.SHARED],
  // The card's parent is the client LIST (owner: the list left the
  // QR screen for its own route). The list itself has no entry: its parent is
  // the app home, the default below.
  [ROUTES_FRONT.CLIENT_CARD, ROUTES_FRONT.CLIENTS],
  [ROUTES_FRONT.PHOTO_DETAIL, ROUTES_FRONT.GALLERY],
  [`${ROUTES_FRONT.GALLERY}/`, ROUTES_FRONT.GALLERY],
];

/** Logical parent of a route pattern; the app home when none is listed. */
export function resolveBackFallback(pathname: string): string {
  for (const [prefix, parent] of PARENT_BY_PREFIX) {
    if (pathname === prefix || pathname.startsWith(prefix)) {
      return parent;
    }
  }
  return ROUTES_FRONT.APP;
}
