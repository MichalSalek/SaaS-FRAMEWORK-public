import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import type { CurrentUser } from '../../models/user/user.types';

export type RoutingPermissionBlockade = {
  currentUser: CurrentUser | undefined;
  currentPathname: string;
  userExistsIsStaticPageCallback: (currentUser: CurrentUser) => void;
  userExistsIsNotStaticPageCallback: (currentUser: CurrentUser) => void;
  userNotExistsCallback: () => void;
};

/** Role with nested permissions — view model derived from GET_PERMISSIONS DTO */
export type RoleWithPermissions =
  ADMIN_DTO_API_V1['ADMIN_GET_PERMISSIONS']['RESPONSE']['roles'][number];

/** Permission — view model derived from GET_PERMISSIONS DTO */
export type PermissionView =
  ADMIN_DTO_API_V1['ADMIN_GET_PERMISSIONS']['RESPONSE']['allPermissions'][number];
