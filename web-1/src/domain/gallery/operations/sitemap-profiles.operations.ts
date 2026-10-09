import { DB_CLIENT } from '@app/db/db.client';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';

export type SitemapProfile = {
  identifier: string;
  updated_at: string;
};

export type SitemapProfilesResult = {
  profiles: SitemapProfile[];
};

/** Safety cap for sitemap entries. */
const SITEMAP_PROFILE_LIMIT = 50000;

/**
 * Row shape returned by the aggregated sitemap raw SQL query.
 * COUNT(*) is bigint in PostgreSQL → returned as bigint by the pg adapter.
 */
type SitemapProfileRow = {
  account_id: string;
  vanity_url: string | null;
  account_created_at: Date;
  latest_record_at: Date | null;
  record_count: bigint;
};

/**
 * Get active stylist profiles for sitemap generation.
 * Returns only ACTIVE accounts that have at least 1 gallery record.
 * Identifier = vanity_url || account_id (string).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Single raw SQL aggregation (INNER JOIN + GROUP BY + MAX) zamiast Prisma
 * findMany z nested gallery_record include. Wczesniejsza wersja generowala N+1
 * (1 query dla listy + 1 query na kazdego stylista przez nested take:1) — przy
 * 50k aktywnych kont = do 50001 round-tripow do DB. Tutaj 1 zapytanie pokrywa:
 * - filtr ACTIVE (WHERE account_status),
 * - filtr created_by_user.is_active=true (INNER JOIN "users") — public visibility contract,
 * - filtr >=1 WIDOCZNEGO gallery_record (INNER JOIN + AND gr.is_hidden=false —
 *   zastepuje Prisma some:{is_hidden:false}; stylista z samymi moderacyjnie ukrytymi
 *   pracami NIE trafia do sitemap = brak soft-404 na pusta strone profilu),
 * - latest WIDOCZNY record timestamp (MAX po juz odfiltrowanych is_hidden=false),
 * - fallback do created_at (kalkulowany po stronie JS).
 * Limit 50000 po SQL — wystarczajaco duzy dla sitemap.xml.
 *
 * DECISION (nie usuwaj tego komentarza):
 * INNER JOIN "users" u ON u.id = sa.created_by_user_id AND u.is_active = true jest częścią
 * public visibility contract: KAŻDY sibling public op MUST mirror account_status=ACTIVE AND
 * created_by_user.is_active=true (SSOT: STYLIST_PUBLICLY_VISIBLE in account.config.ts — this
 * raw-SQL JOIN cannot consume the Prisma where-object, so it mirrors the SAME pair by hand).
 * Tabela User mapuje na "users" (lowercase, @@map wymagany przez Better Auth adapter — NIE
 * "User"). Wcześniej sitemap filtrowal TYLKO account_status — latentny wyciek profilu
 * nieaktywnego usera w sitemap.xml gdyby przyszła ścieżka flipnęła samo User.is_active.
 * Enum cast NA PARAMETRZE (`${...}::"AccountStatus"` w WHERE poniżej) — kanoniczny wzorzec
 * (param-cast, NIE column-cast ::text): zachowuje typ kolumny enum i używalność indeksu
 * [account_status, account_id]. favorite-grouping $queryRaw mirror'uje ten sam param-cast.
 */
export const getSitemapProfiles_IO = async (): Promise<
  OperationResult<SitemapProfilesResult, DatabaseError>
> => {
  let rows: SitemapProfileRow[];
  try {
    rows = await DB_CLIENT.use.$queryRaw<SitemapProfileRow[]>`
      SELECT
        sa.account_id           AS account_id,
        sa.vanity_url           AS vanity_url,
        sa.created_at           AS account_created_at,
        MAX(gr.created_at)      AS latest_record_at,
        COUNT(gr.gallery_record_id) AS record_count
      FROM "StylistAccount" sa
      INNER JOIN "users" u
        ON u.id = sa.created_by_user_id
        AND u.is_active = true
      INNER JOIN "GalleryRecord" gr
        ON gr.created_by_account_id = sa.account_id
        AND gr.is_hidden = false
      WHERE sa.account_status = ${AccountStatusValue.ACTIVE}::"AccountStatus"
      GROUP BY sa.account_id, sa.vanity_url, sa.created_at
      ORDER BY MAX(gr.created_at) DESC NULLS LAST
      LIMIT ${SITEMAP_PROFILE_LIMIT}
    `;
  } catch (error) {
    return databaseFailure('getSitemapProfiles_IO', error);
  }

  const profiles: SitemapProfile[] = rows.map(row => {
    // Use latest gallery record date as "updated_at", fallback to account created_at.
    const lastActivity = row.latest_record_at ?? row.account_created_at;

    return {
      identifier: row.vanity_url ?? row.account_id,
      updated_at: lastActivity.toISOString(),
    };
  });

  return success({ profiles });
};
