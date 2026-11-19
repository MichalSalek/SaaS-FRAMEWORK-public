// main/src/UI/features/admin/hooks/useAdminHealth.ts
import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetHealth_IO } from '../../../../domain/admin/health/adminHealthIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

const fetchHealth = adminGetHealth_IO;

// SSOT for the health poll cadence. UI labels (live pill, refresh-interval
// aria-label) derive their displayed seconds from this constant so the metric
// can never drift from the actual `refetchInterval` (anti-display-lie).
// M6 r28: 60s balances admin observability vs DB connection pressure (10+ parallel external checks per poll).
export const HEALTH_REFETCH_INTERVAL_MS = 60_000;

const adminHealthQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.admin.health,
    queryFn: ({ signal }) => fetchHealth(undefined, { signal }),
    // DD2-M4 r28: align staleTime z refetchInterval — interval to single source of freshness
    staleTime: HEALTH_REFETCH_INTERVAL_MS,
    refetchInterval: HEALTH_REFETCH_INTERVAL_MS,
  });

// Called only from admin pages (AdminLayout, permission-guarded server-side).
// The former `enabled` opt-out existed for the mobile admin variant of the
// shared /app dashboard; that variant is gone (admin /app → /app/admin on every
// viewport, useAdminEntryGuard), so the hook has no non-admin caller left.
export function useAdminHealth() {
  const query = useQuery(adminHealthQueryOptions());
  return {
    health: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}
