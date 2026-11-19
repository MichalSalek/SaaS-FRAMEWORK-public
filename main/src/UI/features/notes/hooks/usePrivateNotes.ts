// The stylist's notes hub read (ACCOUNT_GET_PRIVATE_NOTES). A read: silent on
// failure (the screen renders the error inline with a retry), see
// error-feedback.policy.

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { getPrivateNotes_IO } from '../../../../domain/private-notes/privateNotesIO.possibilities.api';

export function usePrivateNotes(clientUserId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.account.privateNotes(clientUserId),
    queryFn: ({ signal }) =>
      getPrivateNotes_IO(
        {
          ...(clientUserId !== null && { client_user_id: clientUserId }),
        },
        { signal }
      ),
    enabled,
    staleTime: 30_000,
    // Switching the client filter keeps the previous lists on screen until the
    // new ones arrive, instead of flashing the skeleton.
    placeholderData: keepPreviousData,
  });
}
