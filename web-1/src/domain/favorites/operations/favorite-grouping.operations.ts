import { DB_CLIENT } from '@app/db/db.client';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
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
    [favorites, trueCounts] = await Promise.all([
      DB_CLIENT.use.favoriteGalleryRecord.findMany({
        where: {
          client_user_id: id,
          record: {
            is_hidden: false, // Exclude favorites pointing to hidden records
            // Visibility-cascade parity: a removed stylist (disable/ban/soft-delete) must not
            // leak PII in the grouped favorites list. is_hidden alone is insufficient (those
            // paths don't set it) — gate on the shared visibility invariant. The $queryRaw
            // trueCounts below MUST mirror the SAME pair (JOIN StylistAccount+users) so
            // favorites_count never desyncs from recent_favorites. SSOT: STYLIST_PUBLICLY_VISIBLE.
            created_by_account: STYLIST_PUBLICLY_VISIBLE,
          },
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
                    select: { image: true },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
        // DECISION (nie usuwaj tego komentarza):
        // DD2-H4 r28: take: 200 cap is acknowledged limit dla power users z >200 favorites.
        // Stylist-level count w trueCounts liczy pełny SQL aggregate (z is_hidden=false filtrem,
        // patrz DECISION przy $queryRaw — favorite-bookmark-1), ale
        // "recent favorites per stylist" truncates do najnowszych 200 rows globalnie.
        // Power user z 500 favorites zobaczy correct per-stylist counts ale brakuje
        // recent items dla stylists ktorzy wypadli z top-200 najnowszych.
        // No PLATFORM_LIMITS constant for favorites (unlimited by product spec);
        // hardcoded cap is a defensive query bound, not a business limit.
        // Long-term: SQL window function (ROW_NUMBER() OVER stylist PARTITION) replaces
        // JS-side grouping i pozwala na pelne 6-per-stylist bez global truncation
        // (see deferred D7 plan). Pre-launch: pragmatic limit, acceptable trade-off.
        take: 200,
      }),
      DB_CLIENT.use.$queryRaw<
        Array<{ created_by_account_id: string; cnt: bigint }>
      >`
        SELECT gr."created_by_account_id", COUNT(*)::bigint AS cnt
        FROM "FavoriteGalleryRecord" fgr
        JOIN "GalleryRecord" gr ON gr."gallery_record_id" = fgr."gallery_record_id"
        JOIN "StylistAccount" sa ON sa."account_id" = gr."created_by_account_id"
        JOIN "users" u ON u."id" = sa."created_by_user_id"
        WHERE fgr."client_user_id" = ${id}
          AND gr."is_hidden" = false
          AND sa."account_status" = ${AccountStatusValue.ACTIVE}::"AccountStatus"
          AND u."is_active" = true
        GROUP BY gr."created_by_account_id"
      `,
      // DECISION (nie usuwaj tego komentarza):
      // Ten count MUSI liczyć DOKŁADNIE ten sam zbiór co findMany powyżej (recent_favorites)
      // oraz getFavoriteRecords_IO — inaczej favorites_count rozjeżdża się z listą (count desync).
      // Trzy predykaty parytetu:
      // 1. `gr."is_hidden" = false` — moderation HIDE (admin ustawia is_hidden=true, NIE delete;
      //    FK FavoriteGalleryRecord→GalleryRecord persists). Bez tego badge "2" gdy widoczna 1
      //    miniatura + leak istnienia ukrytego itemu (favorite-bookmark-1).
      // 2+3. JOIN StylistAccount + users z `account_status = ACTIVE` AND `is_active = true` —
      //    visibility-cascade: admin disable/ban (account_status !== ACTIVE) i soft-delete
      //    (users.is_active=false) NIE ustawiają is_hidden, więc bez JOIN-u count liczyłby
      //    PII zdjętego stylisty którego nie ma na liście. Mirror findMany `created_by_account`
      //    filtra (STYLIST_PUBLICLY_VISIBLE). `${AccountStatusValue.ACTIVE}` =
      //    parametryzowany (Prisma tagged template), nie raw interpolacja. Cast NA PARAMETRZE
      //    (`$param::"AccountStatus"`), nie na kolumnie — kanoniczny wzorzec z sitemap-profiles:
      //    Postgres NIE coerce'uje `enum = text` bind-param ("operator does not exist:
      //    AccountStatus = text"), a cast po stronie param zachowuje typ kolumny enum, więc
      //    indeks [account_status, account_id] pozostaje używalny (column-side ::text kastuje
      //    kolumnę i może blokować index). NIE usuwaj castu. `"users"` = @@map Better Auth;
      //    surowe `account_status`/`is_active`/`created_by_user_id` bez @map (kolumny = nazwy pól).
      // Pokrywa indeksy [created_by_account_id, is_hidden, created_at] + [account_status, account_id]
      // (schema).
      // DECISION (nie usuwaj tego komentarza): BRAK LIMIT (M8 fix) — to per-user aggregate
      // (WHERE client_user_id = ${id}, GROUP BY stylist), więc liczba wierszy = liczba distinct
      // stylistów w ulubionych callera, bounded per-user (nie memory risk). LIMIT 200 truncował
      // favorites_count dla power-userów >200 distinct stylistów → badge gubił sufit. Pełna,
      // niesucięta liczba jest correctness-critical (count musi zgadzać się z rzeczywistością).
    ]);
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
        stylist_profile_image_url:
          fav.record.created_by_account.created_by_user?.image ?? null,
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
