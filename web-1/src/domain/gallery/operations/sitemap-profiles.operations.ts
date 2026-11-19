import { getSalonProfilePath } from '@kernel/domain/salon-profile/salon.urls';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import { canManageSalonProfile } from '@domain/salon-profile/salon-profile.policy';
import { DB_CLIENT } from '@app/db/db.client';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';

export type SitemapProfile = {
  path?: string;
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

export const getSitemapProfiles_IO = async (): Promise<
  OperationResult<SitemapProfilesResult, DatabaseError>
> => {
  // DECISION: a profile without any public name is NOT listed (owner: onboarding asks only the
  // role, so display_name stays null until the first-photo card). The frontend renders such a profile with a
  // generic label and marks it noindex, and a noindex URL in the sitemap is a contradiction Search Console
  // reports. Blank means NULL or whitespace only, for both display_name and business_name.
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
        AND COALESCE(
          NULLIF(TRIM(sa.display_name), ''),
          NULLIF(TRIM(sa.business_name), '')
        ) IS NOT NULL
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

  try {
    const salons = await DB_CLIENT.use.stylistAccount.findMany({
      where: {
        ...STYLIST_PUBLICLY_VISIBLE,
        salon_profile_name: { not: null },
        pricing_plan: { in: ['STUDIO', 'SCALE'] },
      },
      take: SITEMAP_PROFILE_LIMIT,
    });
    for (const salon of salons) {
      if (canManageSalonProfile(salon)) {
        profiles.push({
          identifier: salon.account_id,
          path: getSalonProfilePath(salon),
          updated_at: salon.created_at.toISOString(),
        });
      }
    }
  } catch (error) {
    return databaseFailure('getSitemapProfiles_IO', error);
  }
  return success({ profiles });
};
