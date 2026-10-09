// Public types of the CreateSessionModal (shared by the organism and its rows
// molecule, which may not import the organism).

export interface StylistOption {
  id: string;
  name: string;
  businessName: string | null;
  avatarUrl: string | null;
  /** Whether a session already exists with this stylist */
  hasActiveSession: boolean;
  /** Id of that open session, when the page knows it — turns the blocked row
   *  into a way INTO the session instead of a dead end. */
  activeSessionId?: string | null;
}

/** State of the query behind `stylists`. `loading`/`error` mean the list is
 *  UNKNOWN, not empty — the modal must not offer „pair with a stylist" then. */
export type StylistsStatus = 'loading' | 'error' | 'ready';

/** Maps the pairs query onto the modal's list status. A failed REFETCH with a
 *  cached NON-EMPTY list stays `ready` (the list is still known); a failure
 *  with nothing cached, or with an EMPTY cached list (TQ v5 keeps it on a
 *  failed refetch), makes the list unknown: „no stylists, pair anew" would be
 *  an unconfirmed claim. */
export function resolveStylistsStatus(query: {
  isLoading: boolean;
  isError: boolean;
  hasData: boolean;
  pairs: readonly unknown[];
}): StylistsStatus {
  if (query.isLoading) {
    return 'loading';
  }
  return query.isError && (!query.hasData || query.pairs.length === 0)
    ? 'error'
    : 'ready';
}
