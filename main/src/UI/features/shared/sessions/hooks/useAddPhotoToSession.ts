// UI/features/shared/sessions/hooks/useAddPhotoToSession.ts
// TQ v5 mutation — POST add photo from stylist gallery to session container.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import { addPhotoToSessionContainer_IO } from '../../../../../domain/session-container/sessionContainerIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../../../application/routing/buildRoute';

/* --- Hook --- */

export function useAddPhotoToSession(sessionId: string) {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (galleryRecordId: string) =>
      addPhotoToSessionContainer_IO({
        session_id: sessionId,
        gallery_record_id: galleryRecordId,
      }),
    meta: { suppressGlobalError: true },
    // DECISION (nie usuwaj tego komentarza): ZERO lokalnego toasta success/error.
    // Warstwa 1 (HTTP interceptor) jest właścicielem — addPhotoToSessionContainer_IO nie
    // ustawia silentBusinessError, więc backendowy event (SESSION_CONTAINER_PHOTO_ADDED na
    // sukcesie / SESSION_CONTAINER_PHOTO_OWNERSHIP / MAX_ACTIVE_EXCEEDED / NOT_PAIRED itd. na
    // błędzie; żaden nie jest w eventsDisallowedForUI) zawsze się toastuje. Lokalny
    // t('addPhotoSuccessToast')/t('addPhotoErrorToast') = inny string → Sonner id
    // nie łapie → DWA toasty (klasa S74/S75). suppressGlobalError gasi TYLKO warstwę 3 — zostaje.
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessionContainer.byId(sessionId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessionContainer.all,
      });
      void router.push(
        buildRoute(ROUTES_FRONT.CLIENT_SESSION_DETAIL, { sessionId })
      );
    },
  });
}
