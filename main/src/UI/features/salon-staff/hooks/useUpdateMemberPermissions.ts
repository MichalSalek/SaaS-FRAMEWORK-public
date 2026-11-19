// UI/features/salon-staff/hooks/useUpdateMemberPermissions.ts
// TQ v5 mutation — PATCH /api/v1/salon/staff/[staffId]/update
// Updates a staff member's permissions.
// Stack: TanStack Query v5.

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateSalonStaffPermissions_IO } from '../../../../domain/salon-staff/salonStaffIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import { flowErrorCode } from '../../shared/analytics/flowErrorCode';
import type {
  SALON_STAFF_DTO_API_V1,
  StaffMemberDTO,
} from '@kernel/models/salon-staff/salon-staff.dto';

/* ─── Types ─── */

type UpdatePermissionsRequest =
  SALON_STAFF_DTO_API_V1['SALON_STAFF_UPDATE_PERMISSIONS']['REQUEST'];

export type UpdatePermissionsVariables = {
  staffId: string;
  data: UpdatePermissionsRequest;
};

type MembersCache = { staff: StaffMemberDTO[] };
type MemberDetailCache = { staff: StaffMemberDTO };

type MutationContext = {
  membersSnapshot: MembersCache | undefined;
  detailSnapshot: MemberDetailCache | undefined;
};

/* ─── Hook ─── */

export function useUpdateMemberPermissions() {
  const queryClient = useQueryClient();

  // DECISION: requests are SERIALISED (a promise chain per hook instance). The optimistic patch
  // below gives EVERY click a fresh full array, but two parallel POSTs can still arrive at the
  // server in reverse order, and then the earlier one (without the second click's change)
  // overwrites the later one: the lost update returns on the server. The queue guarantees the last
  // click (with all changes) lands last.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  // Refetch only when the queue is EMPTY: invalidating after every request
  // rolled the optimistic cache back to the server state ([X]) while Y still
  // waited in the queue, so the next click computed a snapshot without Y and
  // the last POST lost it.
  const pendingRef = useRef(0);

  return useMutation({
    mutationFn: ({ staffId, data }: UpdatePermissionsVariables) => {
      pendingRef.current += 1;
      const run = chainRef.current.then(
        () => updateSalonStaffPermissions_IO(staffId)(data),
        () => updateSalonStaffPermissions_IO(staffId)(data)
      );
      chainRef.current = run
        .catch(() => undefined)
        .finally(() => {
          pendingRef.current -= 1;
          if (pendingRef.current === 0) {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.staff.all,
            });
          }
        });
      return run;
    },
    meta: { suppressGlobalError: true },

    // DECISION: optimistic update on permissions[] removes the lost-update race when toggling
    // quickly. handleTogglePermission computes nextPermissions from member.permissions read from
    // the list cache (queryKeys.staff.members); without the optimistic patch the second quick click
    // reads the OLD array (mutation #1 is still in flight, cache unchanged) and overwrites
    // permissions[] without click #1's change. We patch both caches (members list + byId detail) in
    // onMutate so following clicks read fresh state; snapshot + rollback in onError, final
    // reconciliation with the server in onSettled (server = authoritative SoT). Pattern:
    // useToggleLike.ts.
    onMutate: async ({ staffId, data }: UpdatePermissionsVariables) => {
      const membersKey = queryKeys.staff.members;
      const detailKey = queryKeys.staff.byId(staffId);

      await Promise.all([
        queryClient.cancelQueries({ queryKey: membersKey }),
        queryClient.cancelQueries({ queryKey: detailKey }),
      ]);

      const membersSnapshot =
        queryClient.getQueryData<MembersCache>(membersKey);
      const detailSnapshot =
        queryClient.getQueryData<MemberDetailCache>(detailKey);

      const nextPermissions = data.permissions;
      if (nextPermissions !== undefined) {
        queryClient.setQueryData<MembersCache>(membersKey, prev => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            staff: prev.staff.map(m =>
              m.id === staffId ? { ...m, permissions: nextPermissions } : m
            ),
          };
        });

        queryClient.setQueryData<MemberDetailCache>(detailKey, prev => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            staff: { ...prev.staff, permissions: nextPermissions },
          };
        });
      }

      return { membersSnapshot, detailSnapshot } satisfies MutationContext;
    },

    onSuccess: (_data, { data }: UpdatePermissionsVariables) => {
      trackFlowStep('salon_team', 'permissions_changed', {
        count: data.permissions?.length,
      });
    },

    onError: (
      err: unknown,
      { staffId }: UpdatePermissionsVariables,
      context: MutationContext | undefined
    ) => {
      trackFlowStep('salon_team', 'failed', {
        action: 'permissions',
        code: flowErrorCode(err),
      });
      if (context?.membersSnapshot !== undefined) {
        queryClient.setQueryData(
          queryKeys.staff.members,
          context.membersSnapshot
        );
      }
      if (context?.detailSnapshot !== undefined) {
        queryClient.setQueryData(
          queryKeys.staff.byId(staffId),
          context.detailSnapshot
        );
      }
    },
  });
}
