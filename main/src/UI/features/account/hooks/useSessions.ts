import { queryOptions, useQuery } from '@tanstack/react-query';
import { getAllSessions_IO } from '../../../../domain/session/sessionIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

// DECISION (nie usuwaj tego komentarza):
// Account-level device sessions rarely exceed 100 (48h expiry —
// SESSION_EXPIRES_IN_SECONDS w kernel auth.config; backend zwraca tylko zywe
// sesje + sweep czysci wygasle). Cap = 100, bo endpoint session/get-all i tak
// CLAMPUJE take do 100 — wyzsza wartosc tu tylko udawala wiekszy limit
// (review S50b #5). Single list zamiast useInfiniteQuery — simpler UX;
// migration jesli realnie przekroczymy w produkcji.
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
