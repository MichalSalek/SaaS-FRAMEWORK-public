// DECISION (nie usuwaj tego komentarza): the owner-vote playground frames LIVE
// product routes (DZIŚ and `?pg=` candidates) at a real phone width, because a
// 390 px div inside a desktop page still matches desktop media queries. So on
// DEVELOPMENT and STAGING every route may be framed by its own origin, and only
// /dev/playground may frame. Production keeps `frame-ancestors 'none'` and no
// self frame-src. Clickjacking needs a foreign framing origin; 'self' excludes it.

import { normalizeNavPathname } from '../policies/navigation-transition.policy';

export const PLAYGROUND_ROUTE = '/dev/playground';

export interface PlaygroundFramePolicy {
  /** `frame-src 'self'`: this document may frame same-origin pages. */
  canEmbedSelf: boolean;
  /** `frame-ancestors 'self'` instead of `'none'`. */
  canBeEmbeddedBySelf: boolean;
}

export function resolvePlaygroundFramePolicy(
  path: string,
  devRoutesEnabled: boolean
): PlaygroundFramePolicy {
  if (!devRoutesEnabled) {
    return { canEmbedSelf: false, canBeEmbeddedBySelf: false };
  }
  // The canonical path form (locale prefix from the kernel locale list,
  // trailing slash), not a second hand-written locale regex.
  return {
    canEmbedSelf: normalizeNavPathname(path) === PLAYGROUND_ROUTE,
    canBeEmbeddedBySelf: true,
  };
}
