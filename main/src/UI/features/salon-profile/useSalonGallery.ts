import { queryKeys } from '../../../application/http/queryKeys.factory';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  getSalonGallery_IO,
  getPublicSalonGallery_IO,
} from '../../../domain/salon-profile/salonGalleryIO.possibilities.api';
export function useSalonGallery(
  salonAccountId: string,
  publicOnly = false,
  stylistAccountId = '',
  take?: number
) {
  return useInfiniteQuery({
    queryKey: queryKeys.salon.gallery(
      salonAccountId,
      publicOnly,
      stylistAccountId,
      take
    ),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      (publicOnly ? getPublicSalonGallery_IO : getSalonGallery_IO)(
        {
          salon_account_id: salonAccountId,
          ...(take ? { take } : {}),
          ...(stylistAccountId ? { stylist_account_id: stylistAccountId } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        { signal }
      ),
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: Boolean(salonAccountId),
  });
}
