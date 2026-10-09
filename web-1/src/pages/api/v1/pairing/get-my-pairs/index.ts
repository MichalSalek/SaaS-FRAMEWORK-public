import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { respondSuccess } from '@app/http/http.responses.utils';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import { getMyPairs_IO } from '@domain/pairing/operations/pairing-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { qStr, qInt } from '@app/http/query-params.utils';
export default defineHandler<
  PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['REQUEST'],
  PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.PAIRING.PAIRING_GET_MY_PAIRS,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const cursor = qStr(req.query, 'cursor') ?? undefined;
    const take = qInt(req.query, 'take') ?? 50;

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
      ...(cursor !== undefined && { cursor }),
      take,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const { pairs, nextCursor } = result.data;

    type ResponsePair =
      PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['RESPONSE']['pairs'][number];

    const mappedPairs: ResponsePair[] = pairs.map((p): ResponsePair =>
      'account_id' in p
        ? {
            // id = ClientStylistPair.id: klucz wątku komunikatora (S76) —
            // UI linkuje „Napisz wiadomość" z list par po tym polu.
            id: p.id,
            account_id: p.account_id,
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

    const responsePayload: PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['RESPONSE'] =
      {
        pairs: mappedPairs,
        nextCursor,
      };

    respondSuccess(
      res,
      responsePayload,
      APP_EVENTS.INFO.PAIRING.PAIRING_PAIRS_FETCHED
    );
  },
});
