import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import {
  deleteClientCrmNote_IO,
  getClientCrmNote_IO,
  upsertClientCrmNote_IO,
} from '../../../../domain/visit/visitIO.possibilities.api';

// One scope for every write of this client's note (upsert AND delete).
const crmNoteScopeId = (clientUserId: string): string =>
  `crm-note:${clientUserId}`;

export function useClientCrmNote(clientUserId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.crmNote(clientUserId),
    queryFn: ({ signal }) =>
      getClientCrmNote_IO({ client_user_id: clientUserId }, { signal }),
    enabled: enabled && clientUserId.length > 0,
    staleTime: 30_000,
  });
}

export function useUpsertClientCrmNote(clientUserId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (note: string) =>
      upsertClientCrmNote_IO({ client_user_id: clientUserId, note }),
    // DECISION (nie usuwaj tego komentarza): save-on-blur can fire again
    // while the previous save is in flight. In parallel, an older response
    // landing last wrote the older text into the cache while the field showed
    // the newer one. One scope per client runs the saves in order, so the last
    // response is always the last text typed (TanStack v5 mutation scope).
    scope: { id: crmNoteScopeId(clientUserId) },
    onSuccess: data => {
      queryClient.setQueryData(queryKeys.client.crmNote(clientUserId), data);
    },
  });
}

// D4: kasowanie notatki — własne dane stylistki, działa w każdym stanie pary.
// Odpowiedź = stan po operacji (note: null), wpisywany prosto do cache.
export function useDeleteClientCrmNote(clientUserId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deleteClientCrmNote_IO({ client_user_id: clientUserId }),
    // Same scope as the upsert: a delete must not overtake a save still in
    // flight (the save landing last would bring the note back).
    scope: { id: crmNoteScopeId(clientUserId) },
    onSuccess: data => {
      queryClient.setQueryData(queryKeys.client.crmNote(clientUserId), data);
    },
  });
}
