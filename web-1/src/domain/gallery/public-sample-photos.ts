import { DB_CLIENT } from '@app/db/db.client';
import {
  PINNED_GALLERY_RECORD_ORDER_BY,
  VISIBLE_PINNED_GALLERY_RECORD_WHERE,
} from './gallery-record-visibility';

/** How many works a stylist card in a public list shows. */
export const PUBLIC_SAMPLE_PHOTOS_PER_STYLIST = 3;

// The query is bounded per page: pins are capped by the plan (≤ 50 today) and
// a list page holds ≤ 50 stylists, so one row set covers every card.
const MAX_PINS_READ_PER_STYLIST = 50;

/**
 * First pinned, visible works per account, ONE query for a whole list page.
 * Same predicate and order as the public profile (what a stranger may see):
 * pinned and not hidden by moderation, in the stylist's chosen order, so the
 * cards and JSON-LD show the works she put first. An account without pins gets [].
 * Throws on a database error: the caller maps it inside its own `try`.
 */
export const fetchPublicSamplePhotos = async (
  accountIds: readonly string[]
): Promise<Map<string, string[]>> => {
  const samples = new Map<string, string[]>();
  if (accountIds.length === 0) {
    return samples;
  }
  const rows = await DB_CLIENT.use.galleryRecord.findMany({
    where: {
      created_by_account_id: { in: [...new Set(accountIds)] },
      ...VISIBLE_PINNED_GALLERY_RECORD_WHERE,
    },
    select: { created_by_account_id: true, asset_url: true },
    orderBy: PINNED_GALLERY_RECORD_ORDER_BY,
    take: accountIds.length * MAX_PINS_READ_PER_STYLIST,
  });
  for (const row of rows) {
    const list = samples.get(row.created_by_account_id) ?? [];
    if (list.length < PUBLIC_SAMPLE_PHOTOS_PER_STYLIST) {
      list.push(row.asset_url);
      samples.set(row.created_by_account_id, list);
    }
  }
  return samples;
};
