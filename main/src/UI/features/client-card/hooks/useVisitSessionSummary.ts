import { queryOptions, useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { getSessionContainerById_IO } from '../../../../domain/session-container/sessionContainerIO.possibilities.api';

/** What a visit built from an Inspiration Session borrows from that session. */
export type VisitSessionSummary = {
  photoUrls: string[];
  /** The client's own note on the session: she wrote it and sees it. */
  clientNote: string | null;
};

const visitSessionSummaryQueryOptions = (sessionId: string) =>
  queryOptions({
    // Separate key from byId (which stores the full DTO for the session-detail
    // hooks): this projection stores a small summary. Sharing byId would
    // collide cache shapes (F1) and race silentBusinessError; see the DECISION in
    // queryKeys.factory. See queryKeys.sessionContainer.byIdVisitPhotos.
    queryKey: queryKeys.sessionContainer.byIdVisitPhotos(sessionId),
    queryFn: ({ signal }): Promise<VisitSessionSummary> =>
      // Inspiration photos are best-effort enrichment on the client card: after a
      // client is un-paired the visit keeps its `session_id`, but the stylist may
      // have lost access to that session (dangling ref → 403). `silentBusinessError`
      // makes that fail SOFT — the query settles as isError, the card falls back
      // to nothing, and no global "no access to this session" snackbar fires on
      // every card open. `retry: false` because a business 4xx will never recover.
      getSessionContainerById_IO(
        { session_id: sessionId },
        { signal, silentBusinessError: true }
      ).then(response => ({
        photoUrls: response.session.photos
          .map(photo => photo.galleryRecord?.asset_url)
          .filter((url): url is string => Boolean(url)),
        clientNote: response.session.clientNote?.trim() || null,
      })),
    enabled: sessionId.length > 0,
    staleTime: 30_000,
    retry: false,
  });

export function useVisitSessionSummary(sessionId: string) {
  return useQuery(visitSessionSummaryQueryOptions(sessionId));
}
