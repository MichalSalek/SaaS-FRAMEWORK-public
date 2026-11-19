import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getSalonGallery_IO } from '@domain/salon-gallery/salon-gallery.operations';
import { isNailLengthNarrower } from '@kernel/models/type_narrowing';
import { SALON_PROFILE_CONTRACTS } from '@kernel/domain/salon-profile/salon-profile.contracts';

const galleryProps = (input: {
  salon_account_id: string;
  stylist_account_id?: string;
  cursor?: string;
  take?: number;
  color_ids?: string[];
  trait_ids?: string[];
  nail_length?: string;
}) => {
  const nail_length = isNailLengthNarrower(input.nail_length)
    ? input.nail_length
    : undefined;
  return {
    salon_account_id: input.salon_account_id,
    ...(input.stylist_account_id !== undefined && {
      stylist_account_id: input.stylist_account_id,
    }),
    ...(input.cursor !== undefined && { cursor: input.cursor }),
    ...(input.take !== undefined && { take: input.take }),
    ...(input.color_ids !== undefined && { color_ids: input.color_ids }),
    ...(input.trait_ids !== undefined && { trait_ids: input.trait_ids }),
    ...(nail_length !== undefined && { nail_length }),
  };
};

export default defineEndpoint(SALON_PROFILE_CONTRACTS.SALON_GALLERY_GET, {
  handle: async ({ input, ctx, res, ok }) => {
    const result = await getSalonGallery_IO({
      props: galleryProps(input),
      publicOnly: false,
      ...(ctx.currentUser ? { viewerUserId: ctx.currentUser.id } : {}),
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    ok(result.data, APP_EVENTS.INFO.SALON_PROFILE.SALON_PROFILE_FETCHED);
  },
});
