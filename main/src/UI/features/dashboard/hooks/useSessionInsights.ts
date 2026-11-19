import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { getSessionInsights_IO } from '../../../../domain/session-container/sessionContainerIO.possibilities.api';

/** Plan-gated taste of the stylist's clients. Cheap read; refreshed with the dashboard. */
export const useSessionInsights = () =>
  useQuery({
    queryKey: queryKeys.sessionContainer.insights,
    queryFn: ({ signal }) => getSessionInsights_IO(undefined, { signal }),
    staleTime: 60_000,
  });
