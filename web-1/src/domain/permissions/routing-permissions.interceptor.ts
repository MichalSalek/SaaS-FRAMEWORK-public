import {
  respondSuccess,
  respondUnauthorized,
} from '@app/http/http.responses.utils';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { ROUTES_FRONT_PATH } from '@kernel/domain/routing/routing.types';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { CurrentUser } from '@kernel/models/user/user.types';
import { PERMISSIONS_POLICY } from '@kernel/policies/permissions.policy';
import type { NextApiWithOptionalPayload } from '@app/http/http.types';

// Snapshot of valid ROUTES_FRONT_PATH values for runtime membership checks.
// `as readonly string[]` is required because Object.values on a const-typed
// record returns a union, and Array.prototype.includes is stricter in strict mode.
const ROUTES_FRONT_VALUES: readonly string[] = Object.values(ROUTES_FRONT);

function narrowPathname(value: unknown): ROUTES_FRONT_PATH | null {
  if (typeof value !== 'string') {
    return null;
  }
  return ROUTES_FRONT_VALUES.includes(value)
    ? (value as ROUTES_FRONT_PATH)
    : null;
}

export const isUserShouldBeOnThisRoutePermissionsInterceptor = ({
  req,
  res,
  payload: currentUser,
}: NextApiWithOptionalPayload<CurrentUser>): boolean => {
  // Skip route permission check for API calls (they have their own event-based permissions)
  if (req.url?.startsWith('/api')) {
    return true;
  }

  const currentPathname = narrowPathname(req.headers.pathname);
  if (!currentPathname) {
    // Header missing, non-string, or not a known frontend route.
    // Fail-closed: treat as not permitted (no auth header → not logged → LOGIN_FIRST).
    if (!currentUser) {
      respondUnauthorized(res, undefined, APP_EVENTS.INFO.USER.LOGIN_FIRST);
    } else {
      respondUnauthorized(res, currentUser, APP_EVENTS.INFO.USER.UNAUTHORIZED);
    }
    return false;
  }

  return PERMISSIONS_POLICY.utils.GET_PERMISSION_APPROVAL_FOR_ROUTE_WITH_CALLBACKS(
    {
      currentPathname,
      currentUser,
      userExistsIsStaticPageCallback: currentUser => {
        // Not permitted route (for logged user):
        //
        respondSuccess(res, currentUser, APP_EVENTS.INFO.USER.ALREADY_LOGGED);
      },
      userExistsIsNotStaticPageCallback: currentUser => {
        // Not permitted route, but another than static page - general auth error:
        //
        respondUnauthorized(
          res,
          currentUser,
          APP_EVENTS.INFO.USER.UNAUTHORIZED
        );
      },
      userNotExistsCallback: () => {
        // Not logged and cannot be there:
        //
        respondUnauthorized(res, undefined, APP_EVENTS.INFO.USER.LOGIN_FIRST);
      },
    }
  );
};
