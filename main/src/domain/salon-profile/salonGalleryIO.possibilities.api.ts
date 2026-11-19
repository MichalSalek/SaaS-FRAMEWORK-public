import { contractEndpoint } from '../../application/http/io';
import type { IOClientCallOptions } from '@kernel/application/http/http.client.types';
import type { SalonGalleryRequest } from '@kernel/models/salon-gallery/salon-gallery.dto';
import { SALON_PROFILE_CONTRACTS } from '@kernel/domain/salon-profile/salon-profile.contracts';

const joinIds = (ids: readonly string[] | undefined): string | undefined =>
  ids !== undefined && ids.length > 0 ? ids.join(',') : undefined;

const toQuery = (req: SalonGalleryRequest) => {
  const colorIds = joinIds(req.color_ids);
  const traitIds = joinIds(req.trait_ids);
  return {
    salon_account_id: req.salon_account_id,
    ...(req.stylist_account_id !== undefined && {
      stylist_account_id: req.stylist_account_id,
    }),
    ...(req.cursor !== undefined && { cursor: req.cursor }),
    ...(req.take !== undefined && { take: req.take }),
    ...(colorIds !== undefined ? { color_ids: colorIds } : {}),
    ...(traitIds !== undefined ? { trait_ids: traitIds } : {}),
    ...(req.nail_length !== undefined && { nail_length: req.nail_length }),
  };
};

const salonGallery = contractEndpoint(
  SALON_PROFILE_CONTRACTS.SALON_GALLERY_GET
);
export const getSalonGallery_IO = (
  req: SalonGalleryRequest,
  options?: IOClientCallOptions
) => salonGallery(toQuery(req), options);

const publicSalonGallery = contractEndpoint(
  SALON_PROFILE_CONTRACTS.SALON_GALLERY_PUBLIC_GET
);
export const getPublicSalonGallery_IO = (
  req: SalonGalleryRequest,
  options?: IOClientCallOptions
) => publicSalonGallery(toQuery(req), options);
