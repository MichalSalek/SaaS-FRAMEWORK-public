// UI/features/client/hooks/useClientProfileQuery.ts
// TQ v5 query -- GET client profile (own).
// Stack: TanStack Query v5.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { getClientProfile_IO } from '../../../../domain/client/clientIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { hasSessionToken } from '../../../shared/hooks/currentUser.query';

/* --- Query options (reusable) --- */

const clientProfileQueryOptions = queryOptions({
  queryKey: queryKeys.client.profile,
  queryFn: ({ signal }) => getClientProfile_IO({}, { signal }),
  staleTime: 60_000,
});

/* --- Hook --- */

export function useClientProfileQuery() {
  const account = useCurrentUserAccount();
  const hasClientAccount = account.data?.client_account != null;
  const accountResolved =
    account.isSuccess || account.isError || !hasSessionToken();
  const query = useQuery({
    ...clientProfileQueryOptions,
    enabled: hasClientAccount,
  });
  return {
    ...query,
    isLoading: !accountResolved || query.isLoading,
  };
}
