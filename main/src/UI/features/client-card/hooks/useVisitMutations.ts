import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import type { VISIT_DTO_API_V1 } from '@kernel/models/visit/visit.dto';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ClientVisitsResponse } from './useClientVisits';
import {
  createManualVisit_IO,
  deleteManualVisit_IO,
  removeVisitResultPhoto_IO,
  updateVisitNote_IO,
} from '../../../../domain/visit/visitIO.possibilities.api';

export function useCreateManualVisit(clientUserId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      payload: Pick<
        VISIT_DTO_API_V1['CREATE_MANUAL_VISIT']['REQUEST'],
        'visit_date' | 'service_note'
      >
    ) =>
      createManualVisit_IO({
        client_user_id: clientUserId,
        visit_date: payload.visit_date,
        ...(payload.service_note !== undefined && {
          service_note: payload.service_note,
        }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.client.visits(clientUserId),
      }),
  });
}

export function useUpdateVisitNote(clientUserId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: VISIT_DTO_API_V1['UPDATE_VISIT_NOTE']['REQUEST']) =>
      updateVisitNote_IO(payload),
    // Serial per client card, same reason as the CRM note (useClientCrmNote):
    // an older in-flight save must not land after a newer one.
    scope: { id: `visit-notes:${clientUserId}` },
    onSuccess: data => {
      // Klucz trzyma InfiniteData (useClientVisits = cursor-paginated); patch
      // mapuje każdą stronę — zapis do płaskiego kształtu korumpował cache.
      queryClient.setQueryData<InfiniteData<ClientVisitsResponse>>(
        queryKeys.client.visits(clientUserId),
        current =>
          current
            ? {
                ...current,
                pages: current.pages.map(page => ({
                  ...page,
                  visits: page.visits.map(visit =>
                    visit.id === data.visit.id ? data.visit : visit
                  ),
                })),
              }
            : current
      );
    },
  });
}

export function useDeleteManualVisit(clientUserId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: VISIT_DTO_API_V1['DELETE_MANUAL_VISIT']['REQUEST']) =>
      deleteManualVisit_IO(payload),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.client.visits(clientUserId),
      }),
  });
}

export function useRemoveVisitResultPhoto(clientUserId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      payload: VISIT_DTO_API_V1['REMOVE_VISIT_RESULT_PHOTO']['REQUEST']
    ) => removeVisitResultPhoto_IO(payload),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.client.visits(clientUserId),
      }),
  });
}
