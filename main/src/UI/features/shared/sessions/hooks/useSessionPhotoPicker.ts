// UI/features/shared/sessions/hooks/useSessionPhotoPicker.ts
// Choosing photos for an inspiration session without leaving the gallery:
// which photos are already in the session, and one toggle that puts a photo
// in or takes it back.
//
// DECISION: picking never navigates away from the gallery: a tap adds, a second tap takes
// back, and the session screen is one tap away on the bar under the grid (never push it
// after an add). The session's own query (`sessionContainer.byId`) is the single source of
// „what is in”; both commands return the session and it is written into that cache entry.

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addPhotoToSessionContainer_IO,
  removePhotoFromSessionContainer_IO,
} from '../../../../../domain/session-container/sessionContainerIO.possibilities.api';
import { isActiveSession } from '@kernel/domain/session-container/session-container.types';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import { sessionDetailQueryOptions } from '../../../sessions/hooks/useClientSessionDetail';
import { trackFlowStep } from '../../../../../application/analytics/flow-events';
import type { SessionPhotoOrigin } from './sessionFlowTrace';
import { trackSessionFailed } from './sessionFlowTrace';

export interface SessionPhotoPicker {
  /** False until the session (and so the set of chosen photos) is known. */
  isReady: boolean;
  /** The session could not be read: nothing can be chosen. */
  isError: boolean;
  /** The stylist already has this session: every change reaches her at once. */
  isShared: boolean;
  pickedCount: number;
  isPicked: (galleryRecordId: string) => boolean;
  /** A change of this photo is being saved. */
  isPending: (galleryRecordId: string) => boolean;
  /** Adds the photo, or takes it back when it is already in. */
  toggle: (galleryRecordId: string) => void;
}

/** `origin` only labels the flow trace: where the photo was added or removed. */
export function useSessionPhotoPicker(
  sessionId: string,
  origin: SessionPhotoOrigin = 'gallery_picker'
): SessionPhotoPicker {
  const queryClient = useQueryClient();
  const session = useQuery(sessionDetailQueryOptions(sessionId));
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  const pickedIds = useMemo(
    () => new Set((session.data?.photos ?? []).map(p => p.galleryRecordId)),
    [session.data]
  );

  const change = useMutation({
    mutationFn: ({ id, remove }: { id: string; remove: boolean }) =>
      (remove
        ? removePhotoFromSessionContainer_IO
        : addPhotoToSessionContainer_IO)({
        session_id: sessionId,
        gallery_record_id: id,
      }),
    meta: { suppressGlobalError: true },
    onSuccess: (response, { remove }) => {
      trackFlowStep('session', remove ? 'photo_removed' : 'photo_added', {
        origin,
      });
      queryClient.setQueryData(
        queryKeys.sessionContainer.byId(sessionId),
        response.session
      );
      // Lists show the photo count and the state (a first photo makes a
      // draft „ready”), so they are refreshed; the detail above is exact.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessionContainer.my,
      });
    },
    onError: (error, { remove }) =>
      trackSessionFailed(remove ? 'remove_photo' : 'add_photo', error),
    onSettled: (_data, _error, { id }) => {
      setPendingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
  });

  const { mutate } = change;
  const isReady = session.data !== undefined;
  const toggle = useCallback(
    (id: string) => {
      if (!isReady || pendingIds.has(id)) {
        return;
      }
      setPendingIds(prev => new Set(prev).add(id));
      mutate({ id, remove: pickedIds.has(id) });
    },
    [isReady, pendingIds, pickedIds, mutate]
  );

  return {
    isReady,
    isError: session.isError && !isReady,
    isShared:
      session.data !== undefined &&
      isActiveSession(session.data.lifecycleState),
    pickedCount: pickedIds.size,
    isPicked: id => pickedIds.has(id),
    isPending: id => pendingIds.has(id),
    toggle,
  };
}
