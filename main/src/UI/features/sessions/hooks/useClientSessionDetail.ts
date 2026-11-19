// UI/features/sessions/hooks/useClientSessionDetail.ts
// TQ v5 query — GET session container by ID (client view).
// Stack: TanStack Query v5.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { getSessionContainerById_IO } from '../../../../domain/session-container/sessionContainerIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

/* --- Query options factory (reusable) --- */

// DECISION: cache shape uniformity with useSessionDetail: both hooks share
// queryKeys.sessionContainer.byId(sessionId) and must store the SAME unwrapped
// SessionContainerDetailDTO. Without `.then(r => r.session)` one path stored a wrapper { session:
// ... } and the other the unwrapped DTO, a silent cache collision.
export const sessionDetailQueryOptions = (sessionId: string) =>
  queryOptions({
    queryKey: queryKeys.sessionContainer.byId(sessionId),
    queryFn: ({ signal }) =>
      getSessionContainerById_IO({ session_id: sessionId }, { signal }).then(
        r => r.session
      ),
    enabled: Boolean(sessionId),
    staleTime: 30_000,
  });

/* --- Hook --- */

export function useClientSessionDetail(sessionId: string | undefined) {
  return useQuery(sessionDetailQueryOptions(sessionId ?? ''));
}
