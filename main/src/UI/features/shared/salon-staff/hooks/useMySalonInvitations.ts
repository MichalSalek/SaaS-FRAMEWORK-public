// UI/features/shared/salon-staff/hooks/useMySalonInvitations.ts
// TQ v5 query: GET /api/v1/salon/invitations, the logged-in person's own
// pending salon-team invitations (invitee side, any role).
//
// Shared (not under features/salon-staff) because three surfaces read the same
// cache entry: the invitations screen, the drawer item (AppLayout) and the
// account-screen card. One key, TanStack dedups the request.
//
// No refetchInterval on purpose: an invitation is a rare, e-mail-announced
// event, so the drawer does not poll for it the way it polls unread messages.
// The entry is refreshed on mount/focus after staleTime and invalidated by the
// respond mutation.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { getMySalonInvitations_IO } from '../../../../../domain/salon-staff/salonStaffIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import {
  resolveSalonInvitationsEntry,
  type SalonInvitationsEntry,
} from '../salonInvitationsEntry';

export const mySalonInvitationsQueryOptions = (enabled: boolean) =>
  queryOptions({
    queryKey: queryKeys.staff.myInvitations,
    queryFn: ({ signal }) => getMySalonInvitations_IO(undefined, { signal }),
    enabled,
    staleTime: 60_000,
  });

export function useMySalonInvitations(enabled = true) {
  return useQuery(mySalonInvitationsQueryOptions(enabled));
}

/**
 * State of the entry points (drawer item, account card). A failed read is its
 * own state, never 0: see the DECISION in salonInvitationsEntry.ts.
 */
export function useMySalonInvitationsEntry(enabled: boolean): {
  entry: SalonInvitationsEntry;
  refetch: () => void;
  isRefetching: boolean;
} {
  const { data, isError, isFetching, refetch } = useMySalonInvitations(enabled);
  return {
    entry: resolveSalonInvitationsEntry({
      enabled,
      pendingCount: data?.invitations.length,
      isError,
    }),
    refetch: () => void refetch(),
    isRefetching: isFetching,
  };
}
