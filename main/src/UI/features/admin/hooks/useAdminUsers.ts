// UI/features/admin/hooks/useAdminUsers.ts
// TQ v5 hook for paginated admin users list.
// queryKey: queryKeys.admin.users(filters) — already typed via factory.

import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/react-query';
import { adminGetUsersPaginated_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

export type AdminUsersRequest =
  ADMIN_DTO_API_V1['ADMIN_GET_USERS_PAGINATED']['REQUEST'];
type AdminUsersResponse =
  ADMIN_DTO_API_V1['ADMIN_GET_USERS_PAGINATED']['RESPONSE'];
export type AdminUserRecord = AdminUsersResponse['records'][number];

/* ─── Fetcher ─── */

const fetchUsers = adminGetUsersPaginated_IO;

/* ─── Query options (shareable) ─── */

const adminUsersQueryOptions = (filters: AdminUsersRequest) =>
  queryOptions({
    queryKey: queryKeys.admin.users(filters),
    queryFn: ({ signal }) => fetchUsers(filters, { signal }),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

/* ─── Hook ─── */

// `enabled` — strona trzyma zapytanie, dopóki nie odczyta filtrów z adresu
// (useUrlSyncedState), żeby nie pobierać najpierw listy z domyślnymi filtrami.
export function useAdminUsers(filters: AdminUsersRequest, enabled = true) {
  return useQuery({ ...adminUsersQueryOptions(filters), enabled });
}
