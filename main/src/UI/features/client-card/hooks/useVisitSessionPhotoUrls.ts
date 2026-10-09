import { queryOptions, useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { getSessionContainerById_IO } from '../../../../domain/session-container/sessionContainerIO.possibilities.api';

const visitSessionPhotoUrlsQueryOptions = (sessionId: string) =>
  queryOptions({
    // Separate key from byId (which stores the full DTO for the session-detail
    // hooks): this projection stores a string[] of photo URLs. Sharing byId would
    // collide cache shapes (F1) and race silentBusinessError — patrz DECISION w
    // queryKeys.factory. See queryKeys.sessionContainer.byIdVisitPhotos.
    queryKey: queryKeys.sessionContainer.byIdVisitPhotos(sessionId),
    queryFn: ({ signal }) =>
      // Inspiration photos are best-effort enrichment on the client card: after a
      // client is un-paired the visit keeps its `session_id`, but the stylist may
      // have lost access to that session (dangling ref → 403). `silentBusinessError`
      // makes that fail SOFT — the query settles as isError, this hook falls back
      // to [] below, and no global "no access to this session" snackbar fires on
      // every card open. `retry: false` because a business 4xx will never recover.
      getSessionContainerById_IO(
        { session_id: sessionId },
        { signal, silentBusinessError: true }
      ).then(response =>
        response.session.photos
          .map(photo => photo.galleryRecord?.asset_url)
          .filter((url): url is string => Boolean(url))
      ),
    enabled: sessionId.length > 0,
    staleTime: 30_000,
    retry: false,
  });

export function useVisitSessionPhotoUrls(sessionId: string) {
  return useQuery(visitSessionPhotoUrlsQueryOptions(sessionId));
}
