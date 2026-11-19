// UI/features/shared/sessions/hooks/usePhotoSessionAction.ts
// „Dodaj do sesji inspiracji” on one photo: what a client who is looking at a
// stylist's photo can do with it and her session for that stylist.
//
// DECISION: from a photo, the client adds it to her open session with this stylist, or
// the same tap creates one (no dialog, as everywhere a session with a stylist starts).
// Add and take-back belong to `useSessionPhotoPicker` (the one mechanism); only „create,
// then add” lives here. Mount for a resolved client role only: it reads her sessions and
// pairs. (owner)

import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addPhotoToSessionContainer_IO,
  createSessionContainer_IO,
} from '../../../../../domain/session-container/sessionContainerIO.possibilities.api';
import {
  countSessionsTowardSharedLimit,
  isSharedSessionLimitReached,
} from '@kernel/domain/session-container/session-container.limit';
import {
  isActiveSession,
  isTerminalSession,
} from '@kernel/domain/session-container/session-container.types';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import {
  flattenClientSessionPages,
  useClientSessions,
} from '../../../sessions/hooks/useClientSessions';
import { usePairedStylists } from '../../pairing/hooks/usePairedStylists';
import { useSessionPhotoPicker } from './useSessionPhotoPicker';
import { trackFlowStep } from '../../../../../application/analytics/flow-events';
import { trackSessionFailed } from './sessionFlowTrace';

export type PhotoSessionAction =
  /** Nothing to offer: not connected with this stylist, or not known yet. */
  | { kind: 'hidden' }
  /** No session with her yet and the limit of shared sessions is reached. */
  | { kind: 'limit' }
  | {
      kind: 'ready';
      /** Her open session with this stylist; null until the first photo. */
      sessionId: string | null;
      /** The stylist already has that session. */
      isShared: boolean;
      isPicked: boolean;
      isPending: boolean;
      toggle: () => void;
    };

export function usePhotoSessionAction(
  stylistAccountId: string,
  galleryRecordId: string
): PhotoSessionAction {
  const queryClient = useQueryClient();
  const sessionsQuery = useClientSessions();
  const { pairs } = usePairedStylists();

  const openSessions = useMemo(
    () =>
      flattenClientSessionPages(sessionsQuery.data).filter(
        s => !isTerminalSession(s.lifecycleState)
      ),
    [sessionsQuery.data]
  );
  const existingId =
    openSessions.find(s => s.stylistAccountId === stylistAccountId)?.id ?? null;

  // DECISION: see useSessionPhotoPicker.ts (no local toast, layer 1 owns errors).
  const start = useMutation({
    mutationFn: async () => {
      const created = await createSessionContainer_IO({
        stylist_account_id: stylistAccountId,
      });
      return addPhotoToSessionContainer_IO({
        session_id: created.session.id,
        gallery_record_id: galleryRecordId,
      });
    },
    meta: { suppressGlobalError: true },
    onSuccess: response => {
      trackFlowStep('session', 'created', { origin: 'photo_detail' });
      trackFlowStep('session', 'photo_added', { origin: 'photo_detail' });
      queryClient.setQueryData(
        queryKeys.sessionContainer.byId(response.session.id),
        response.session
      );
    },
    // One failure for the pair: the create or the first photo did not land.
    onError: error => trackSessionFailed('create', error),
    // Also after a failure: the session may exist without the photo.
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessionContainer.my,
      });
    },
  });

  // The list refetch lags behind the create; the mutation result bridges it.
  const sessionId = existingId ?? start.data?.session.id ?? null;
  const picker = useSessionPhotoPicker(sessionId ?? '', 'photo_detail');

  const isConnected = pairs.some(
    p => p.stylistAccountId === stylistAccountId && !p.isInactive
  );
  if (
    sessionsQuery.data === undefined ||
    (!isConnected && sessionId === null)
  ) {
    return { kind: 'hidden' };
  }

  if (sessionId === null) {
    // Same rule as the backend (kernel session-container.limit.ts): a
    // stylist reached through a salon takes no slot of the shared limit.
    const salonStylistIds = new Set(
      pairs.filter(p => p.viaSalon).map(p => p.stylistAccountId)
    );
    const sharedCount = countSessionsTowardSharedLimit(
      openSessions.map(s => ({
        stylistAccountId: s.stylistAccountId,
        isShared: isActiveSession(s.lifecycleState),
      })),
      salonStylistIds
    );
    if (
      !salonStylistIds.has(stylistAccountId) &&
      isSharedSessionLimitReached(sharedCount)
    ) {
      return { kind: 'limit' };
    }
    return {
      kind: 'ready',
      sessionId: null,
      isShared: false,
      isPicked: false,
      isPending: start.isPending,
      toggle: () => {
        if (!start.isPending) {
          start.mutate();
        }
      },
    };
  }

  return {
    kind: 'ready',
    sessionId,
    isShared: picker.isShared,
    isPicked: picker.isPicked(galleryRecordId),
    isPending: !picker.isReady || picker.isPending(galleryRecordId),
    toggle: () => picker.toggle(galleryRecordId),
  };
}
