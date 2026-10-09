// UI/features/salon-staff/hooks/useSalonStaffById.ts
// TQ v5 query — GET /api/v1/salon/staff/[staffId]
// Fetches a single staff member detail by ID.
// Stack: TanStack Query v5.

import { queryOptions, skipToken, useQuery } from '@tanstack/react-query';
import { getSalonStaffById_IO } from '../../../../domain/salon-staff/salonStaffIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

/* ─── Hook ─── */

export function useSalonStaffById(staffId: string | null) {
  // skipToken as queryFn prevents any request when staffId is absent.
  // Never pass '' — byId('') would fire with an empty param.
  const { data, isLoading, isError, isFetching, refetch } = useQuery(
    queryOptions({
      queryKey: queryKeys.staff.byId(staffId ?? ''),
      queryFn: staffId
        ? ({ signal }) => getSalonStaffById_IO(staffId)(undefined, { signal })
        : skipToken,
      staleTime: 30_000,
    })
  );

  return {
    staff: data?.staff ?? null,
    isLoading: Boolean(staffId) && isLoading,
    isError,
    isFetching,
    /** Retry of a failed load (the dialog shows the error inline). */
    refetch,
  };
}
