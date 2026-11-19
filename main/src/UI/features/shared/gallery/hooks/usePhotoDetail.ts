// main/src/UI/features/gallery/hooks/usePhotoDetail.ts
// TQ v5 query -- fetches a single gallery record by ID.
// Returns record data, stylist info, and owner detection.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { isIOError } from '../../../../../application/http/io';
import { getGalleryRecordById_IO } from '../../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import { useCurrentUserAccount } from '../../../../shared/hooks/useCurrentUserAccount';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';

/* --- Types --- */

export type PhotoDetailData =
  GALLERY_DTO_API_V1['GET_GALLERY_RECORD_BY_ID']['RESPONSE'];

/* --- Error classification --- */

// Events that mean „this photo is not there for you" (the backend masks a
// foreign/deleted record as CANNOT_GET_GALLERY_RECORD 404). Everything else
// (network, 5xx, timeout) is „could not check" and gets a retry, not a
// „photo not found" verdict.
const NOT_FOUND_EVENTS: ReadonlySet<string> = new Set<string>([
  APP_EVENTS.INFO.GALLERY.CANNOT_GET_GALLERY_RECORD,
  APP_EVENTS.INFO.APPLICATION.NOT_FOUND,
  APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO,
  APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
]);

export function isPhotoNotFoundError(error: unknown): boolean {
  return isIOError(error) && NOT_FOUND_EVENTS.has(error.httpError.event);
}

/* --- Query options --- */

const photoDetailQueryOptions = (galleryRecordId: string) =>
  queryOptions({
    queryKey: queryKeys.gallery.byId(galleryRecordId),
    queryFn: ({ signal }) =>
      getGalleryRecordById_IO(
        { gallery_record_id: galleryRecordId },
        { signal }
      ),
    enabled: galleryRecordId.length > 0,
    staleTime: 30_000,
  });

/* --- Hook --- */

export function usePhotoDetail(galleryRecordId: string) {
  const query = useQuery(photoDetailQueryOptions(galleryRecordId));
  const { data: currentUser } = useCurrentUserAccount();

  const isOwner =
    currentUser?.stylist_account != null &&
    query.data?.stylist_info.account_id != null &&
    currentUser.stylist_account.account_id ===
      query.data.stylist_info.account_id;

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    isNotFound: query.isError && isPhotoNotFoundError(query.error),
    isRefetching: query.isFetching,
    refetch: query.refetch,
    isOwner,
  };
}
