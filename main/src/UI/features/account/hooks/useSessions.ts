import { queryOptions, useQuery } from '@tanstack/react-query';
import { getAllSessions_IO } from '../../../../domain/session/sessionIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

// DECISION: account-level device sessions rarely exceed 100 (48h expiry: SESSION_EXPIRES_IN_SECONDS
// in kernel auth.config; the backend returns only live sessions and a sweep cleans expired ones).
// Cap = 100 because the session/get-all endpoint CLAMPS take to 100; a higher value here only
// pretended to a bigger limit. A single list instead of useInfiniteQuery is simpler UX; migrate if
// production really exceeds it.
const SESSIONS_TAKE_CAP = 100;

const sessionsQueryOptions = queryOptions({
  queryKey: queryKeys.session.all,
  queryFn: ({ signal }) =>
    getAllSessions_IO({ take: SESSIONS_TAKE_CAP }, { signal }),
  staleTime: 30_000,
});

export function useSessions() {
  return useQuery(sessionsQueryOptions);
}
