// UI/features/shared/gallery/hooks/usePinnedOrder.ts
// Order of the stylist's pinned works on her public profile: the read (own visible
// pins in public order) and the reorder command, optimistic with rollback.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  galleryGetPinnedRecords_IO,
  galleryReorderPinnedRecords_IO,
} from '../../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';

export type PinnedOrderData =
  GALLERY_DTO_API_V1['GALLERY_GET_PINNED_RECORDS']['RESPONSE'];
export type PinnedOrderRecord = PinnedOrderData['records'][number];
export type PinnedMoveDirection = 'up' | 'down';

const REORDER_MUTATION_KEY = ['gallery', 'reorderPinned'] as const;

/**
 * The list with one item moved one step. Same array back when the step would leave
 * the list, so a caller can tell "nothing to send" by reference.
 */
export function movePinnedRecord<T>(
  items: readonly T[],
  index: number,
  direction: PinnedMoveDirection
): readonly T[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (
    index < 0 ||
    index >= items.length ||
    target < 0 ||
    target >= items.length
  ) {
    return items;
  }
  const next = [...items];
  const moved = next[index];
  const other = next[target];
  if (moved === undefined || other === undefined) {
    return items;
  }
  next[index] = other;
  next[target] = moved;
  return next;
}

const pinnedOrderQueryOptions = {
  queryKey: queryKeys.gallery.pinned,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    galleryGetPinnedRecords_IO(undefined, { signal }),
  staleTime: 30_000,
};

/** Refetch the order and every surface that shows it, once the queue is empty. */
const settleWhenIdle = (queryClient: QueryClient) => {
  // Each move is queued behind the previous one (mutation scope below); refetching
  // after every settle would paint a server answer older than the moves still
  // waiting in the queue, so the cache follows the server only when nothing is left.
  if (queryClient.isMutating({ mutationKey: REORDER_MUTATION_KEY }) > 1) {
    return;
  }
  void queryClient.invalidateQueries({ queryKey: queryKeys.gallery.pinned });
  // Surfaces that show the public order: the profile gallery (any account key) and
  // the public profile (sample photos, JSON-LD) of every identifier.
  void queryClient.invalidateQueries({
    queryKey: [...queryKeys.gallery.all, 'byAccount'],
  });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.account.profileAll,
  });
};

export function usePinnedOrder() {
  const queryClient = useQueryClient();
  const query = useQuery(pinnedOrderQueryOptions);

  const reorder = useMutation({
    mutationKey: REORDER_MUTATION_KEY,
    // DECISION: every request carries the FULL order computed at click time, so the last one
    // processed is the state. The scope runs requests one after another: otherwise a slow earlier
    // request could land last and put an older order back on the public profile.
    scope: { id: 'gallery-reorder-pinned' },
    mutationFn: (records: readonly PinnedOrderRecord[]) =>
      galleryReorderPinnedRecords_IO({
        gallery_record_ids: records.map(record => record.gallery_record_id),
      }),

    onMutate: async (records: readonly PinnedOrderRecord[]) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.gallery.pinned });
      const snapshot = queryClient.getQueryData<PinnedOrderData>(
        queryKeys.gallery.pinned
      );
      queryClient.setQueryData<PinnedOrderData>(queryKeys.gallery.pinned, {
        records: [...records],
      });
      return { snapshot };
    },

    // The HTTP interceptor shows the failure (GALLERY_PINNED_ORDER_STALE when another
    // tab changed the pins, INTERNET_CONNECTION_PROBLEM offline); here the list only
    // goes back to what it was before this move, and the refetch below brings the
    // server truth.
    onError: (_err, _records, context) => {
      if (context?.snapshot !== undefined) {
        queryClient.setQueryData<PinnedOrderData>(
          queryKeys.gallery.pinned,
          context.snapshot
        );
      }
    },

    onSettled: () => settleWhenIdle(queryClient),
  });

  const records = query.data?.records ?? [];

  const move = (index: number, direction: PinnedMoveDirection): boolean => {
    const next = movePinnedRecord(records, index, direction);
    if (next === records) {
      return false;
    }
    reorder.mutate(next);
    return true;
  };

  return { ...query, records, move };
}
