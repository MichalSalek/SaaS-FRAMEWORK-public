// main/src/UI/features/shared/gallery/hooks/useTogglePin.ts
// TQ v5 mutation -- toggles pin/unpin on a gallery record.
// Optimistic update on the detail query cache.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  galleryPinRecord_IO,
  galleryUnpinRecord_IO,
} from '../../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import { trackFlowStep } from '../../../../../application/analytics/flow-events';
import { flowErrorCode } from '../../analytics/flowErrorCode';
import type { getUserUsageStats_IO } from '../../../../../domain/user/userIO.possibilities.api';
import type { InfiniteData } from '@tanstack/react-query';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import type { PhotoDetailData } from './usePhotoDetail';

type GalleryListPage = GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['RESPONSE'];
type UsageStatsData = Awaited<ReturnType<typeof getUserUsageStats_IO>>;

/* --- Hook --- */

export function useTogglePin(
  galleryRecordId: string,
  options?: { onError?: (error: unknown, wasPinned: boolean) => void }
) {
  const queryClient = useQueryClient();
  const detailKey = queryKeys.gallery.byId(galleryRecordId);

  return useMutation({
    mutationFn: (isPinned: boolean) => {
      const req = { gallery_record_id: galleryRecordId };
      return isPinned
        ? galleryUnpinRecord_IO(req)
        : galleryPinRecord_IO(req, { silentBusinessError: true });
    },
    meta: { suppressGlobalError: true },

    onMutate: async (isPinned: boolean) => {
      await queryClient.cancelQueries({ queryKey: detailKey });

      const snapshot = queryClient.getQueryData<PhotoDetailData>(detailKey);

      queryClient.setQueryData<PhotoDetailData>(detailKey, prev => {
        if (!prev) {
          return prev;
        }
        return { ...prev, is_pinned: !isPinned };
      });

      // The same change in EVERY loaded gallery list (the pin manager on
      // /app/profile, the /app/gallery grid). Without it the tile reverted to
      // the old state for the round trip, because the list waits for onSettled's invalidate.
      const listSnapshots = queryClient.getQueriesData<
        InfiniteData<GalleryListPage>
      >({ queryKey: queryKeys.gallery.all });
      queryClient.setQueriesData<InfiniteData<GalleryListPage>>(
        { queryKey: queryKeys.gallery.all },
        prev => {
          if (!prev?.pages) {
            return prev;
          }
          return {
            ...prev,
            pages: prev.pages.map(page => ({
              ...page,
              records: page.records.map(record =>
                record.gallery_record_id === galleryRecordId
                  ? { ...record, is_pinned: !isPinned }
                  : record
              ),
            })),
          };
        }
      );

      // DECISION: the pinned counter is optimistic too. Quota status reads `pinned_records`;
      // waiting for the onSettled invalidate left it one behind for the whole round trip, so at
      // the plan ceiling she could pin once past the limit and watch the tile revert on the
      // server's refusal. The snapshot is restored in onError with the rest.
      const usageKey = queryKeys.account.usageStats;
      const usageSnapshot = queryClient.getQueryData<UsageStatsData>(usageKey);
      queryClient.setQueryData<UsageStatsData>(usageKey, prev =>
        prev === undefined
          ? prev
          : {
              ...prev,
              pinned_records: prev.pinned_records + (isPinned ? -1 : 1),
            }
      );

      return { snapshot, listSnapshots, usageSnapshot };
    },

    // Pin business errors are handled by the caller so a limit refusal can offer
    // the next eligible plan; transport and server errors stay with the interceptor.
    onError: (err, wasPinned, context) => {
      options?.onError?.(err, wasPinned);
      trackFlowStep('pin', 'failed', {
        action: wasPinned ? 'unpin' : 'pin',
        code: flowErrorCode(err),
      });
      if (context?.snapshot !== undefined) {
        queryClient.setQueryData<PhotoDetailData>(detailKey, context.snapshot);
      }
      context?.listSnapshots?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      if (context?.usageSnapshot !== undefined) {
        queryClient.setQueryData<UsageStatsData>(
          queryKeys.account.usageStats,
          context.usageSnapshot
        );
      }
    },

    onSuccess: (_data, wasPinned) => {
      trackFlowStep('pin', wasPinned ? 'unpinned' : 'pinned');
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.dashboardFeed,
      });
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: detailKey });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gallery.all,
      });
      // The „pinned X of Y” counter lives in usage-stats (SSOT of the plan
      // limit), so it must refresh together with the list: otherwise the pin
      // manager shows the old ratio and blocks pinning too early.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.usageStats,
      });
    },
  });
}
