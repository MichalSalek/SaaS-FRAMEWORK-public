// „Ważne przed wizytą” (owner): the stylist's ONE short safety note about a client.
// Read on the client card, the stylist's session screen and (through the notes hub read) on
// /app/notes. No plan gate: see the DECISION in web-1 client-important-note.operations.ts.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type { ClientImportantNoteDTO } from '@kernel/models/visit/visit.dto';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import { trackFlowStep } from '../../../../../application/analytics/flow-events';
import {
  getClientImportantNote_IO,
  upsertClientImportantNote_IO,
} from '../../../../../domain/visit/visitIO.possibilities.api';

export function useClientImportantNote(clientUserId: string | null) {
  return useQuery({
    queryKey: queryKeys.client.importantNote(clientUserId ?? ''),
    queryFn: ({ signal }) =>
      getClientImportantNote_IO(
        { client_user_id: clientUserId ?? '' },
        { signal }
      ),
    enabled: clientUserId !== null && clientUserId.length > 0,
    staleTime: 30_000,
  });
}

export function useUpsertClientImportantNote(
  clientUserId: string,
  onConfirmed?: (data: ClientImportantNoteDTO) => void
) {
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
      const revision = exactRevision
        ? expectedUpdatedAt
        : (ownRevisions.current.get(expectedUpdatedAt) ?? expectedUpdatedAt);
      const data = await upsertClientImportantNote_IO(
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
    // Saves run in order (one scope per client), so the last response is the last text typed;
    // see the DECISION at useUpsertClientCrmNote.
    scope: { id: `important-note:${clientUserId}` },
    onSuccess: data => {
      onConfirmed?.(data);
      trackFlowStep('client_card', 'important_note_saved', {
        cleared: data.note === null,
      });
      queryClient.setQueryData<ClientImportantNoteDTO>(
        queryKeys.client.importantNote(clientUserId),
        current => {
          if (
            current?.updatedAt &&
            data.updatedAt &&
            Date.parse(current.updatedAt) > Date.parse(data.updatedAt)
          ) {
            return current;
          }
          return data;
        }
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.privateNotesAll,
      });
    },
  });
}
