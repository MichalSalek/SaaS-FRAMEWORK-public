import { queryOptions, useQuery } from '@tanstack/react-query';
import type { CLIENT_DTO_API_V1 } from '@kernel/models/client/client.dto';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { getClientContactForStylist_IO } from '../../../../domain/client/clientIO.possibilities.api';

export type ClientContactForStylistResponse =
  CLIENT_DTO_API_V1['CLIENT_GET_CONTACT_FOR_STYLIST']['RESPONSE'];

const clientContactForStylistQueryOptions = (
  clientUserId: string,
  enabled = true
) =>
  queryOptions({
    queryKey: queryKeys.client.contactForStylist(clientUserId),
    queryFn: ({ signal }) =>
      getClientContactForStylist_IO(
        { client_user_id: clientUserId },
        { signal }
      ),
    enabled: enabled && clientUserId.length > 0,
    staleTime: 120_000,
    retry: false,
  });

export function useClientContactForStylist(
  clientUserId: string,
  enabled = true
) {
  return useQuery(clientContactForStylistQueryOptions(clientUserId, enabled));
}
