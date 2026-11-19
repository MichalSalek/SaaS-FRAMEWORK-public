import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { getMyPairs_IO } from '@domain/pairing/operations/pairing-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { PAIRING_CONTRACTS } from '@kernel/domain/pairing/pairing.contracts';

export default defineEndpoint(PAIRING_CONTRACTS.PAIRING_GET_MY_PAIRS, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);

    // Active role decides view, not stylist_account presence.
    // Dual-role users (CLIENT with legacy stylist_account) must see CLIENT pairs.
    const isStylistRole = currentUser.role_id === SystemRoleId.STYLIST_ROLE;
    const stylistAccountId = currentUser.stylist_account?.account_id;

    const result = await getMyPairs_IO({
      current_user_id: currentUser.id,
      ...(isStylistRole &&
        stylistAccountId && {
          current_stylist_account_id: stylistAccountId,
        }),
      ...(input.cursor !== undefined && { cursor: input.cursor }),
      take: input.take,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const { pairs, nextCursor } = result.data;

    const mappedPairs = pairs.map(p =>
      'account_id' in p
        ? {
            // id is ClientStylistPair.id, the messaging thread key.
            // The UI links „Napisz wiadomość" from the pair list through this field.
            id: p.id,
            account_id: p.account_id,
            ...(p.salon_origin_account_id !== undefined
              ? { salon_origin_account_id: p.salon_origin_account_id }
              : {}),
            display_name: p.display_name,
            business_name: p.business_name,
            address_city: p.address_city,
            avatar_url: p.avatar_url,
            paired_at: p.paired_at.toISOString(),
            counterpart_inactive: p.counterpart_inactive,
          }
        : {
            id: p.id,
            user_id: p.user_id,
            name: p.name,
            email: p.email,
            paired_at: p.paired_at.toISOString(),
            counterpart_inactive: p.counterpart_inactive,
          }
    );

    ok(
      {
        pairs: mappedPairs,
        nextCursor,
        ...(result.data.salons ? { salons: result.data.salons } : {}),
      },
      APP_EVENTS.INFO.PAIRING.PAIRING_PAIRS_FETCHED
    );
  },
});
