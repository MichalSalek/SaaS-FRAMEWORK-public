import type { UiSectionId } from '../domain/permissions/permissions.config';
import {
  PERMISSIONS_FOR_ROLE_BY_ROUTE,
  PERMISSIONS_FOR_ROLE_BY_UI_SECTION,
} from '../domain/permissions/permissions.config';
import type { RoutingPermissionBlockade } from '../domain/permissions/permissions.types';
import type { ROUTES_FRONT_PATH } from '../domain/routing/routing.types';
import type { User } from '../models/db_models.generated.dto';
import type { Role, UserWithRole } from '../models/db_models.manual.dto';
import {
  RoleValue,
  SystemRoleId,
  ROLE_ID_TO_NAME,
} from '../models/db_models.manual.dto';
import type { IDType } from '../application/application.types';
import { ROUTING_POLICY } from './routing.policy';

export type PERMISSIONS_POLICY_TYPE = {
  PERMISSIONS_FOR_ROLE_BY_ROUTE: Readonly<
    Record<ROUTES_FRONT_PATH, ReadonlySet<Role>>
  >;

  utils: {
    GET_PERMISSION_APPROVAL_FOR_ROUTE: (props: {
      role?: Role;
      roleId?: IDType | undefined;
      requestedRoutePath: ROUTES_FRONT_PATH | string;
    }) => boolean;
    GET_PERMISSION_APPROVAL_FOR_SECTION: (props: {
      roleId?: IDType | undefined;
      section: UiSectionId;
    }) => boolean;
    IS_ADMIN: (props: {
      user?: Pick<User, 'role_id'> | Pick<UserWithRole, 'role_id' | 'role'>;
    }) => boolean;
    GET_PERMISSION_APPROVAL_FOR_ROUTE_WITH_CALLBACKS: (
      props: RoutingPermissionBlockade
    ) => boolean;
  };
};

export const PERMISSIONS_POLICY: PERMISSIONS_POLICY_TYPE = {
  PERMISSIONS_FOR_ROLE_BY_ROUTE: Object.freeze(PERMISSIONS_FOR_ROLE_BY_ROUTE),

  utils: {
    GET_PERMISSION_APPROVAL_FOR_SECTION: ({ roleId, section }) => {
      const roleName = roleId
        ? (ROLE_ID_TO_NAME[roleId] ?? RoleValue.NOT_LOGGED_IN)
        : RoleValue.NOT_LOGGED_IN;
      const allowedRoles = PERMISSIONS_FOR_ROLE_BY_UI_SECTION[section];
      return allowedRoles?.has(roleName) ?? false;
    },

    GET_PERMISSION_APPROVAL_FOR_ROUTE: ({
      role,
      roleId,
      requestedRoutePath,
    }) => {
      const typedRoutePath = requestedRoutePath as ROUTES_FRONT_PATH;
      const normalizedPath = ROUTING_POLICY.utils.NORMALIZE_PATH({
        path: typedRoutePath,
      }) as ROUTES_FRONT_PATH;

      // Get role name from roleId if provided
      let roleName: Role = RoleValue.NOT_LOGGED_IN;
      if (roleId) {
        roleName = ROLE_ID_TO_NAME[roleId] ?? RoleValue.NOT_LOGGED_IN;
      } else if (role) {
        roleName = role;
      }

      // Direct lookup first
      const directMatch =
        PERMISSIONS_POLICY.PERMISSIONS_FOR_ROLE_BY_ROUTE[normalizedPath];
      if (directMatch !== undefined) {
        return directMatch.has(roleName);
      }

      // Fallback: match against dynamic route templates (e.g. /stylist/1 → /stylist/[identifier])
      const matchedTemplate = ROUTING_POLICY.utils.FIND_MATCHING_ROUTE({
        path: normalizedPath,
        routes: PERMISSIONS_POLICY.PERMISSIONS_FOR_ROLE_BY_ROUTE,
      }) as ROUTES_FRONT_PATH | null;
      if (matchedTemplate) {
        return (
          PERMISSIONS_POLICY.PERMISSIONS_FOR_ROLE_BY_ROUTE[
            matchedTemplate
          ]?.has(roleName) ?? false
        );
      }

      return false;
    },

    IS_ADMIN: ({ user }) => {
      return user?.role_id === SystemRoleId.MASTER_ADMIN;
    },

    GET_PERMISSION_APPROVAL_FOR_ROUTE_WITH_CALLBACKS: ({
      currentUser,
      currentPathname,
      userExistsIsStaticPageCallback,
      userExistsIsNotStaticPageCallback,
      userNotExistsCallback,
    }) => {
      const normalizedPath = ROUTING_POLICY.utils.NORMALIZE_PATH({
        path: currentPathname,
      });

      if (
        !PERMISSIONS_POLICY.utils.GET_PERMISSION_APPROVAL_FOR_ROUTE({
          roleId: currentUser?.role_id ?? undefined,
          requestedRoutePath: normalizedPath,
        })
      ) {
        if (currentUser?.id) {
          // User exists

          if (
            ROUTING_POLICY.utils.IS_STATIC_PAGE({
              requestedRoutePath: normalizedPath,
            })
          ) {
            // e.g. login or register page

            // Not permitted route (for logged user):
            //
            userExistsIsStaticPageCallback(currentUser);
            return false;
          } else {
            userExistsIsNotStaticPageCallback(currentUser);
            return false;
          }
        } else {
          // User not exists.

          if (
            ROUTING_POLICY.utils.IS_STATIC_PAGE({
              requestedRoutePath: normalizedPath,
            })
          ) {
            // For static pages (login, register), allow access without calling callback
            return true;
          } else {
            // For protected pages, user must be logged in
            userNotExistsCallback();
            return false;
          }
        }
      }
      return true;
    },
  } as const,
} as const;
