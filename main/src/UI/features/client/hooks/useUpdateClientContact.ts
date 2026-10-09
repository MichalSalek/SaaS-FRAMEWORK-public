// UI/features/client/hooks/useUpdateClientContact.ts
// TQ v5 mutation -- POST update client contact (phone, email).
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateClientContact_IO } from '../../../../domain/client/clientIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { CLIENT_DTO_API_V1 } from '@kernel/models/client/client.dto';

/* --- Types --- */

type UpdateContactRequest =
  CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['REQUEST'];

/* --- Hook --- */

export function useUpdateClientContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: UpdateContactRequest) => updateClientContact_IO(req),
    // suppressGlobalError wyłącza tylko warstwę 3 (globalny MutationCache fallback).
    // Toasty (sukces CLIENT_CONTACT_UPDATED + błędy backendu) pushuje interceptor
    // http (warstwa 1) — strona NIE dokłada własnych (double-toast S74/S75).
    meta: { suppressGlobalError: true },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.client.all,
      });
    },
  });
}
