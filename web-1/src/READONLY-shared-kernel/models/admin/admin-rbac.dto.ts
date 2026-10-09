import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type {
  PermissionEntity,
  RoleEntity,
  RolePermissionEntity,
} from '../db_models.generated.dto';

type GetPermissionsResponse = {
  roles: Array<
    Pick<RoleEntity, 'id' | 'name' | 'description' | 'is_system'> & {
      permissions: Array<
        Pick<RolePermissionEntity, 'permission_id'> & {
          permission: Pick<PermissionEntity, 'id' | 'event_name' | 'category'>;
        }
      >;
    }
  >;
  allPermissions: Array<
    Pick<
      PermissionEntity,
      'id' | 'event_name' | 'category' | 'description' | 'is_system'
    >
  >;
};

type UpdatePermissionsRequest = {
  role_id: RoleEntity['id'];
  permission_ids: PermissionEntity['id'][];
};

export type AdminRbacDtoApi = {
  /** Zwraca role z przypisanymi uprawnieniami oraz pełną listę dostępnych uprawnień (RBAC). */
  ADMIN_GET_PERMISSIONS: {
    REQUEST: undefined;
    RESPONSE: GetPermissionsResponse;
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      GetPermissionsResponse,
      DetailedErrorPayload<undefined>
    >;
  };

  /** Nadpisuje zestaw uprawnień przypisanych do wskazanej roli. */
  ADMIN_UPDATE_PERMISSIONS: {
    REQUEST: UpdatePermissionsRequest;
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<UpdatePermissionsRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      UpdatePermissionsRequest,
      undefined,
      DetailedErrorPayload<UpdatePermissionsRequest>
    >;
  };
};
