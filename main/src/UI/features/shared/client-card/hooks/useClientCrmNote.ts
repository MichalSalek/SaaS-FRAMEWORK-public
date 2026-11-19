import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import { trackFlowStep } from '../../../../../application/analytics/flow-events';
import {
  deleteClientCrmNote_IO,
  getClientCrmNote_IO,
  upsertClientCrmNote_IO,
} from '../../../../../domain/visit/visitIO.possibilities.api';

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
  const ownRevisions = useRef(new Map<string | null, string | null>());

  return useMutation({
    mutationFn: async ({
      note,
      expectedUpdatedAt,
      exactRevision,
    }: {
      note: string;
      expectedUpdatedAt: string | null;
      exactRevision?: boolean;
    }) => {
      if (exactRevision) {
        ownRevisions.current.clear();
      }
      const current = queryClient.getQueryData<{
        note: string | null;
        updatedAt: string | null;
      }>(queryKeys.client.crmNote(clientUserId));
      if (
        expectedUpdatedAt === null &&
        current?.note === null &&
        current.updatedAt === null
      ) {
        ownRevisions.current.clear();
      }
      const savedRevision = exactRevision
        ? undefined
        : ownRevisions.current.get(expectedUpdatedAt);
      const revision =
        savedRevision === undefined ? expectedUpdatedAt : savedRevision;
      const data = await upsertClientCrmNote_IO(
        {
          client_user_id: clientUserId,
          note,
          expected_updated_at: revision,
        },
        { silentBusinessError: true }
      );
      for (const [baseline, latest] of ownRevisions.current) {
        if (latest === revision) {
          ownRevisions.current.set(baseline, data.updatedAt);
        }
      }
      ownRevisions.current.set(expectedUpdatedAt, data.updatedAt);
      return data;
    },
    // DECISION: blur saves share a scope with deletion. The draft keeps its own baseline revision;
    // only this hook's confirmed saves advance queued revisions, never an external refetch.
    // Test: useClientCrmNote.test.ts (own queued saves and external conflicts; not cross-tab delivery).
    scope: { id: crmNoteScopeId(clientUserId) },
    onSuccess: data => {
      trackFlowStep('client_card', 'note_saved', { cleared: false });
      queryClient.setQueryData(queryKeys.client.crmNote(clientUserId), data);
    },
  });
}

// Delete the note: the stylist's own data, works in any pair state.
// The response = the state after the operation (note: null), written straight to the cache.
export function useDeleteClientCrmNote(clientUserId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deleteClientCrmNote_IO({ client_user_id: clientUserId }),
    // Same scope as the upsert: a delete must not overtake a save still in
    // flight (the save landing last would bring the note back).
    scope: { id: crmNoteScopeId(clientUserId) },
    onSuccess: data => {
      trackFlowStep('client_card', 'note_saved', { cleared: true });
      queryClient.setQueryData(queryKeys.client.crmNote(clientUserId), data);
    },
  });
}
