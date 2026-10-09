import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { useGalleryFiltersState } from '../../shared/gallery/hooks/useGalleryFiltersState';

type OwnGalleryRecord =
  GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['RESPONSE']['records'][number];

export function useOwnGalleryFilters(records: OwnGalleryRecord[]) {
  return useGalleryFiltersState<OwnGalleryRecord>(records);
}
