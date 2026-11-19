import { resolvePersonAvatarUrl } from '@kernel/domain/user/avatar.policy';
import { DB_CLIENT } from '@app/db/db.client';
import {
  favoriteReadableRecordWhere,
  resolveFavoriteReadScope_IO,
} from './favorite-access';
import type { IDType } from '@kernel/application/application.types';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import {
  type OperationResult,
  success,
} from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';

type GroupedResponse = FAVORITE_DTO_API_V1['FAVORITE_GET_GROUPED']['RESPONSE'];

export const getFavoriteGrouped_IO = async ({
  id,
}: {
  id: IDType;
}): Promise<OperationResult<GroupedResponse, DatabaseError>> => {
  let favorites;
  let trueCounts;
  try {
    // DECISION: same read boundary as getFavoriteRecords_IO (favorite-access.ts): the access scope, the
    // rows and the counts come from ONE Repeatable Read snapshot and the scope is applied in SQL, so a like
    // whose access is gone never returns its image_url and favorites_count stays equal to the readable rows.
    [favorites, trueCounts] = await DB_CLIENT.use.$transaction(
      async tx => {
        const scope = await resolveFavoriteReadScope_IO(id, tx);
        return Promise.all([
          tx.favoriteGalleryRecord.findMany({
            where: {
              client_user_id: id,
              // Visibility-cascade parity + current access (pinned, or author reachable now). The $queryRaw
              // trueCounts below MUST mirror the SAME predicate so favorites_count never desyncs from
              // recent_favorites. SSOT: favoriteReadableRecordWhere.
              record: favoriteReadableRecordWhere(scope),
            },
            select: {
              id: true,
              gallery_record_id: true,
              created_at: true,
              record: {
                select: {
                  asset_url: true,
                  created_by_account_id: true,
                  created_by_account: {
                    select: {
                      display_name: true,
                      created_by_user: {
                        select: { image: true, avatar_url: true },
                      },
                    },
                  },
                },
              },
            },
            orderBy: {
              created_at: 'desc',
            },
            // DECISION: take: 200 is a defensive query bound, not a business limit (favorites are unlimited by
            // product spec). Per-stylist counts come from the full SQL aggregate below, but "recent favorites
            // per stylist" is truncated to the newest 200 rows globally, so a power user may miss recent items
            // of older stylists. A ROW_NUMBER() window per stylist would lift it; acceptable pre-launch.
            take: 200,
          }),
          tx.$queryRaw<Array<{ created_by_account_id: string; cnt: bigint }>>`
        SELECT gr."created_by_account_id", COUNT(*)::bigint AS cnt
        FROM "FavoriteGalleryRecord" fgr
        JOIN "GalleryRecord" gr ON gr."gallery_record_id" = fgr."gallery_record_id"
        JOIN "StylistAccount" sa ON sa."account_id" = gr."created_by_account_id"
        JOIN "users" u ON u."id" = sa."created_by_user_id"
        WHERE fgr."client_user_id" = ${id}
          AND gr."is_hidden" = false
          AND sa."account_status" = ${AccountStatusValue.ACTIVE}::"AccountStatus"
          AND u."is_active" = true
          AND (gr."is_pinned" = true
               OR gr."created_by_account_id" = ANY(${scope.accessibleStylistIds}::text[]))
        GROUP BY gr."created_by_account_id"
      `,
          // DECISION: this count MUST cover exactly the set of the findMany above and of getFavoriteRecords_IO,
          // or favorites_count desyncs from the list. Three parity predicates: (1) gr.is_hidden = false
          // (moderation HIDE sets is_hidden, it does not delete); (2+3) JOIN StylistAccount and users with
          // account_status = ACTIVE and is_active = true, because admin disable/ban and soft-delete do not set
          // is_hidden (mirror of STYLIST_PUBLICLY_VISIBLE). The status is a bind parameter cast on the PARAMETER
          // (`$param::"AccountStatus"`), never on the column: Postgres does not coerce `enum = text`, and a
          // column-side cast could block the [account_status, account_id] index. Do not remove the cast.
          // `"users"` is the Better Auth @@map; the other raw column names equal the field names.
          // There is NO LIMIT on purpose: it is a per-user aggregate (one row per distinct favorited stylist,
          // bounded), and a LIMIT 200 truncated favorites_count for power users. The last predicate mirrors the
          // OR of favoriteReadableRecordWhere; the id list is ONE array bind parameter, not a nested fragment.
        ]);
      },
      { isolationLevel: 'RepeatableRead' }
    );
  } catch (error) {
    return databaseFailure('getFavoriteGrouped_IO', error);
  }

  const countMap = new Map(
    trueCounts.map(r => [r.created_by_account_id, Number(r.cnt)])
  );

  // Group by stylist_account_id
  const groupMap = new Map<
    string,
    {
      stylist_display_name: string | null;
      stylist_profile_image_url: string | null;
      favorites: Array<{
        favorite_id: string;
        gallery_record_id: string;
        image_url: string;
        created_at: string;
      }>;
    }
  >();

  for (const fav of favorites) {
    const accountId = fav.record.created_by_account_id;
    let group = groupMap.get(accountId);

    if (!group) {
      group = {
        stylist_display_name:
          fav.record.created_by_account.display_name ?? null,
        stylist_profile_image_url: resolvePersonAvatarUrl(
          fav.record.created_by_account.created_by_user ?? {}
        ),
        favorites: [],
      };
      groupMap.set(accountId, group);
    }

    group.favorites.push({
      favorite_id: fav.id,
      gallery_record_id: fav.gallery_record_id,
      image_url: fav.record.asset_url,
      created_at: fav.created_at.toISOString(),
    });
  }

  const groups: GroupedResponse['groups'] = Array.from(groupMap.entries()).map(
    ([accountId, group]) => ({
      stylist_account_id: accountId,
      stylist_display_name: group.stylist_display_name,
      stylist_profile_image_url: group.stylist_profile_image_url,
      favorites_count: countMap.get(accountId) ?? group.favorites.length,
      recent_favorites: group.favorites.slice(0, 6),
    })
  );

  return success({ groups });
};
