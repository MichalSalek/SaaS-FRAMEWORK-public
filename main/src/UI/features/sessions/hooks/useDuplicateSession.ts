import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { duplicateSessionContainer_IO } from '../../../../domain/session-container/sessionContainerIO.possibilities.api';

/** Closed sessions are irreversible; this creates a fresh DRAFT with the same
 *  photos and note and opens it. */
export const useDuplicateSession = () => {
  const router = useRouter();
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      duplicateSessionContainer_IO({ session_id: sessionId }),
    onSuccess: data => {
      void cache.invalidateQueries({
        queryKey: queryKeys.sessionContainer.all,
      });
      void router.push(
        buildRoute(ROUTES_FRONT.CLIENT_SESSION_DETAIL, {
          sessionId: data.session.id,
        })
      );
    },
  });
};
