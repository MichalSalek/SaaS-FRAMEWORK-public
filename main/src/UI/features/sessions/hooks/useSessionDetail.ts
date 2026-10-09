// UI/features/sessions/hooks/useSessionDetail.ts
// TQ v5 query — GET /api/v1/session-container/get-by-id
// Fetches a single session container with hydrated photos[] for the stylist view.
// Stack: TanStack Query v5.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { getSessionContainerById_IO } from '../../../../domain/session-container/sessionContainerIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

/* --- Types --- */

// DECISION (nie usuwaj tego komentarza):
// Bliźniaczy factory w useClientSessionDetail.ts (client view) celowo dzieli ten
// sam cache-key queryKeys.sessionContainer.byId — oba unwrapują .session do tego
// samego SessionContainerDetailDTO (uniformity cache-shape, F1). NIE konsolidować
// do jednej factory: hooki różnią się kontraktem wejścia (string vs string|undefined,
// enabled length>0 vs Boolean) i należą do osobnych bounded-contextów (stylist/client);
// rule-of-three jeszcze nietrafione. Spójność klucza pilnuje współdzielony queryKeys.
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
