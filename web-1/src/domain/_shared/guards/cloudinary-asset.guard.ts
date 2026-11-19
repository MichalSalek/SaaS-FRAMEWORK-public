// cloudinary-asset.guard.ts
// Shared ownership gate for the cloud file behind EVERY surface that accepts an `asset_url` from
// the client. Today three, all entering here: gallery work (gallery-create.operation), visit
// result photo (visit-result-photo.operations), profile photo (account-avatar.operations). The
// list is explicit on purpose: the header once said "EVERY" while naming two, and the gallery, the
// LARGEST surface and the source of addresses for the others, dropped out unnoticed. Adding a
// fourth surface with a client `*_url`? Call from here AND add it to this list (guard:
// audit:asset-ownership).
//
// DECISION: this lives in `_shared` because the gate started as a private function for visit
// photos, and the stylist profile photo (2026-09-09) is a second surface with EXACTLY the same
// vector (browser upload straight to the cloud -> the backend receives only the address -> the
// `public_id` used to delete the file is derived from it). Splitting a security check into two copies
// means one gets the fix and the other does not, so copying this code would cost more than extracting it.

import { DB_CLIENT } from '@app/db/db.client';
import type { Prisma } from '../../../prisma/js-client';
import {
  assetUrlReferencesPublicId,
  extractPublicIdFromUrl,
} from '@app/cloudinary/cloudinary-url.utils';

/**
 * Is the file behind this `asset_url` already held by ANOTHER account?
 *
 * DECISION: compare by `public_id`, NOT by URL. The first version matched the URL literal and was
 * bypassable: cloud deletion works on a `public_id` derived from the URL, and one `public_id` has
 * many spellings (`.../victim.jpg?x=1` and `.../upload/w_1/v123/victim.jpg` point at the same file
 * as `.../upload/v123/victim.jpg`), so submitting a variant passed the gate and deleted someone
 * else's photo. The decision is equality of the identifier derived from BOTH sides (attacker and
 * row), never a literal match (see the DECISION at the query below). A URL without a `public_id`
 * is rejected: if we cannot say what it points at, we cannot say it is not foreign (fail-closed).
 */
export type AssetOwnershipVerdict = 'OWN' | 'FOREIGN' | 'UNRECOGNIZED_URL';

export const findForeignAssetOwner = async (
  assetUrl: string,
  principal: string | { userId: string },
  tx?: Prisma.TransactionClient
): Promise<AssetOwnershipVerdict> => {
  const publicId = extractPublicIdFromUrl(assetUrl);
  if (publicId === null) {
    // Stays fail-closed (if we cannot say what it points at, we cannot say it is not foreign),
    // but the cause is distinguished: accusing a stylist of taking someone else's file when she
    // gave an unsupported format sent the diagnosis the wrong way.
    return 'UNRECOGNIZED_URL';
  }

  const db = tx ?? DB_CLIENT.use;

  // Existing gallery and visit callers identify the owned stylist account; new callers
  // identify the authenticated person. Membership in someone else's salon grants no ownership.
  const account =
    typeof principal === 'string'
      ? await db.stylistAccount.findUnique({
          where: { account_id: principal },
          select: { created_by_user_id: true },
        })
      : await db.stylistAccount.findUnique({
          where: { created_by_user_id: principal.userId },
          select: { account_id: true },
        });
  const userId =
    typeof principal === 'string'
      ? account && 'created_by_user_id' in account
        ? account.created_by_user_id
        : null
      : principal.userId;
  // A missing legacy account is handled by the caller. With no known user,
  // every user and salon-logo reference remains foreign.
  const stylistAccountId =
    typeof principal === 'string'
      ? principal
      : account && 'account_id' in account
        ? account.account_id
        : '';

  // DECISION: TWO PATHS, BOTH REQUIRED. PATH A (index): `public_id` is filled on write, so "does
  // anyone else hold this file" is a plain index read (0.461 ms vs 87.1 ms per table at 200k rows
  // when the whole address column was pulled and compared in code).
  //
  // PATH B (rows with `public_id IS NULL`) must not be cut "because the backfill finished": a row
  // from which an identifier CANNOT be derived holds `NULL`, so path A does not see it, and the
  // index alone would recreate the HIGH hole (a victim stored non-canonically drops out of the
  // comparison, the gate compares an EMPTY SET, says OWN, and the attacker takes someone else's
  // file). Rationale: SCHEMA_DECISIONS.md#asset-public-id.
  //
  // Path B's cost is proportional to the number of UNPARSEABLE rows, not table size, and the
  // backfill reports that number (`scripts/backfill-asset-public-id.ts`). If it grows, it signals
  // a hole in `extractPublicIdFromUrl`, not an invitation to remove the check.
  const [
    galleryIndexed,
    photoIndexed,
    avatarIndexed,
    galleryUnparsed,
    photoUnparsed,
    userIndexed,
    logoIndexed,
    userUnparsed,
    logoUnparsed,
    avatarUnparsed,
  ] = await Promise.all([
    db.galleryRecord.findFirst({
      where: {
        created_by_account_id: { not: stylistAccountId },
        public_id: publicId,
      },
      select: { gallery_record_id: true },
    }),
    db.visitResultPhoto.findFirst({
      where: {
        stylist_account_id: { not: stylistAccountId },
        public_id: publicId,
      },
      select: { id: true },
    }),
    db.stylistAccount.findFirst({
      where: {
        account_id: { not: stylistAccountId },
        avatar_public_id: publicId,
      },
      select: { account_id: true },
    }),
    db.galleryRecord.findMany({
      where: {
        created_by_account_id: { not: stylistAccountId },
        public_id: null,
      },
      select: { asset_url: true },
    }),
    db.visitResultPhoto.findMany({
      where: {
        stylist_account_id: { not: stylistAccountId },
        public_id: null,
      },
      select: { asset_url: true },
    }),
    db.user.findFirst({
      where: {
        ...(userId ? { id: { not: userId } } : {}),
        avatar_public_id: publicId,
      },
      select: { id: true },
    }),
    db.stylistAccount.findFirst({
      where: {
        ...(userId ? { created_by_user_id: { not: userId } } : {}),
        salon_logo_public_id: publicId,
      },
      select: { account_id: true },
    }),
    db.user.findMany({
      where: {
        ...(userId ? { id: { not: userId } } : {}),
        avatar_url: { not: null },
        avatar_public_id: null,
      },
      select: { avatar_url: true },
    }),
    db.stylistAccount.findMany({
      where: {
        ...(userId ? { created_by_user_id: { not: userId } } : {}),
        salon_logo_url: { not: null },
        salon_logo_public_id: null,
      },
      select: { salon_logo_url: true },
    }),
    // The profile photo is the third place where a file URL LIVES, so it must protect the same
    // way as the other two; otherwise someone else's avatar would be the only appropriable file.
    db.stylistAccount.findMany({
      where: {
        account_id: { not: stylistAccountId },
        avatar_url: { not: null },
        avatar_public_id: null,
      },
      select: { avatar_url: true },
    }),
  ]);

  if (
    galleryIndexed !== null ||
    photoIndexed !== null ||
    avatarIndexed !== null ||
    userIndexed !== null ||
    logoIndexed !== null
  ) {
    return 'FOREIGN';
  }

  // DECISION: an UNRECOGNISED row counts as FOREIGN. Its address CONTAINS our identifier and we
  // cannot decompose it, so we cannot rule out that it points elsewhere either; uncertainty is
  // resolved in favour of the file's owner. The rule lives in `assetUrlReferencesPublicId`, shared
  // with the reference check at deletion so the two do not drift apart again.
  const unparsedUrls = [
    ...galleryUnparsed.map(row => row.asset_url),
    ...photoUnparsed.map(row => row.asset_url),
    ...userUnparsed
      .map(row => row.avatar_url)
      .filter((url): url is string => url !== null),
    ...logoUnparsed
      .map(row => row.salon_logo_url)
      .filter((url): url is string => url !== null),
    ...avatarUnparsed
      .map(row => row.avatar_url)
      .filter((url): url is string => url !== null),
  ];

  const isForeign = unparsedUrls.some(url =>
    assetUrlReferencesPublicId(url, publicId)
  );
  return isForeign ? 'FOREIGN' : 'OWN';
};
