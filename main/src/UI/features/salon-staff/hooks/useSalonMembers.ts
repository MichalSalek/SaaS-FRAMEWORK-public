// UI/features/salon-staff/hooks/useSalonMembers.ts
// TQ v5 query — GET /api/v1/salon/staff
// Fetches all staff members for the current stylist's salon.
// Stack: TanStack Query v5.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { getSalonStaff_IO } from '../../../../domain/salon-staff/salonStaffIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

/* ─── Query options (reusable) ─── */

const salonMembersQueryOptions = queryOptions({
  queryKey: queryKeys.staff.members,
  queryFn: ({ signal }) => getSalonStaff_IO(undefined, { signal }),
  staleTime: 30_000,
});

/* ─── Hook ─── */

export function useSalonMembers() {
  const { data, isLoading, isFetching, isError, refetch } = useQuery(
    salonMembersQueryOptions
  );

  return {
    members: data?.staff ?? [],
    isLoading,
    isFetching,
    isError,
    /** The roster is known. `members: []` without it means "unknown", not "no team". */
    hasData: data !== undefined,
    refetch,
  };
}
