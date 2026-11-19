// UI/features/sessions/hooks/useSessionDetail.ts
// TQ v5 query — GET /api/v1/session-container/get-by-id
// Fetches a single session container with hydrated photos[] for the stylist view.
// Stack: TanStack Query v5.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { getSessionContainerById_IO } from '../../../../domain/session-container/sessionContainerIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

/* --- Types --- */

// DECISION: the twin factory in useClientSessionDetail.ts (client view) deliberately shares this
// cache key queryKeys.sessionContainer.byId: both unwrap `.session` to the same
// SessionContainerDetailDTO. Do NOT consolidate them into one factory: the hooks differ in input
// contract (string vs string|undefined, enabled length>0 vs Boolean) and belong to separate bounded
// contexts (stylist/client); rule of three is not yet met. Key consistency is kept by the shared
// queryKeys.
const sessionDetailQueryOptions = (sessionId: string) =>
  queryOptions({
    queryKey: queryKeys.sessionContainer.byId(sessionId),
    queryFn: ({ signal }) =>
      getSessionContainerById_IO({ session_id: sessionId }, { signal }).then(
        r => r.session
      ),
    enabled: sessionId.length > 0,
    staleTime: 30_000,
  });

/* --- Hook --- */

export function useSessionDetail(sessionId: string) {
  return useQuery(sessionDetailQueryOptions(sessionId));
}
