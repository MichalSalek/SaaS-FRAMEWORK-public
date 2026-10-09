// UI/features/salon-staff/hooks/useUpdateMemberPermissions.ts
// TQ v5 mutation — PATCH /api/v1/salon/staff/[staffId]/update
// Updates a staff member's permissions.
// Stack: TanStack Query v5.

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { updateSalonStaffPermissions_IO } from '../../../../domain/salon-staff/salonStaffIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
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
  const t = useTranslations('salon.staff');

  // DECISION (nie usuwaj tego komentarza): żądania są SZEREGOWANE (łańcuch
  // promise per instancja hooka). Optimistic patch niżej daje KAŻDEMU klikowi
  // świeży pełny array, ale dwa równoległe POST-y i tak potrafią dojechać na
  // serwer w odwrotnej kolejności — wtedy wcześniejszy (bez zmiany z kliku #2)
  // nadpisuje późniejszy i lost-update wraca po stronie serwera. Kolejka
  // gwarantuje, że ostatni klik (z kompletem zmian) ląduje ostatni.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  // Refetch dopiero, gdy kolejka jest PUSTA: inwalidacja po każdym żądaniu
  // cofała optimistic cache do stanu serwera ([X]) w trakcie, gdy Y czekał w
  // kolejce — kolejny klik liczył snapshot bez Y i ostatni POST go gubił.
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

    // DECISION (nie usuwaj tego komentarza):
    // Optimistic update na permissions[] — eliminuje lost-update race przy
    // szybkim przełączaniu wielu togglów. handleTogglePermission liczy
    // nextPermissions z member.permissions czytanego z list-cache
    // (queryKeys.staff.members). Bez optimistic patcha drugi szybki klik czyta
    // STARY array (mutacja #1 jeszcze leci → cache niezmieniony) i nadpisuje
    // permissions[] bez zmiany z kliku #1 → lost update na pełnej tablicy.
    // Patchujemy oba cache (members list + byId detail) w onMutate, więc kolejne
    // kliknięcia czytają świeży stan. Snapshot + rollback w onError, finalna
    // reconciliacja z serwerem w onSettled (server = autorytatywny SoT).
    // Wzorzec: useToggleLike.ts (optimistic + snapshot rollback + onSettled).
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

    onError: (
      _err: unknown,
      { staffId }: UpdatePermissionsVariables,
      context: MutationContext | undefined
    ) => {
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
      pushNewSnackbar(t('permissionsError'), 'error');
    },

    onSuccess: () => {
      pushNewSnackbar(t('permissionsSuccess'), 'success');
    },
  });
}
