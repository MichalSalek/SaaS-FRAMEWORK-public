// asset-ownership-allow: the demo showcase builds URLs from its own photo bank
// (demo-content-seeding.bank.ts; a name outside the bank throws), never from the
// request body. There is no client input for the ownership gate to check. The
// seed also never runs outside dev/staging (demo-content-seeding.guard.ts).
import { DB_CLIENT } from '@app/db/db.client';

export const DEMO_REMOVED_PHOTO_NAMES: readonly string[] = Object.freeze([
  'portfolio-sample-002',
  'portfolio-sample-007',
  'portfolio-sample-008',
  'portfolio-sample-025',
  'portfolio-sample-026',
  'portfolio-sample-027',
  'portfolio-sample-030',
  'portfolio-sample-031',
  'portfolio-sample-033',
  'portfolio-sample-034',
  'portfolio-sample-038',
  'portfolio-sample-040',
  'portfolio-sample-043',
  'portfolio-sample-044',
  'portfolio-sample-046',
  'portfolio-sample-049',
  'portfolio-sample-050',
  'portfolio-sample-051',
  'portfolio-sample-052',
  'portfolio-sample-053',
  'portfolio-sample-054',
]);

/** Fragment adresu jednoznaczny dla pliku: '/demo-seed/<nazwa>_'. */
const urlFragment = (name: string): string => `/demo-seed/${name}_`;

const REMOVED_URL_FILTERS = DEMO_REMOVED_PHOTO_NAMES.map(name => ({
  contains: urlFragment(name),
}));

/** Kasuje zgłoszenia moderacyjne wskazanych zdjęć, potem same zdjęcia. */
export const deleteGalleryRecordsById_IO = async (
  recordIds: readonly string[]
): Promise<number> => {
  if (recordIds.length === 0) {
    return 0;
  }
  await DB_CLIENT.use.contentReport.deleteMany({
    where: { gallery_record_id: { in: [...recordIds] } },
  });
  const deleted = await DB_CLIENT.use.galleryRecord.deleteMany({
    where: { gallery_record_id: { in: [...recordIds] } },
  });
  return deleted.count;
};

/**
 * Deletes rows that point at retired files: the gallery (with cascades),
 * visit-result photos (a separate table, no FK to the gallery) and account avatars.
 */
export const purgeRemovedDemoAssets_IO = async (
  results: string[]
): Promise<void> => {
  const records = await DB_CLIENT.use.galleryRecord.findMany({
    where: { OR: REMOVED_URL_FILTERS.map(f => ({ asset_url: f })) },
    select: { gallery_record_id: true },
  });
  const galleryDeleted = await deleteGalleryRecordsById_IO(
    records.map(r => r.gallery_record_id)
  );

  const visitPhotos = await DB_CLIENT.use.visitResultPhoto.deleteMany({
    where: { OR: REMOVED_URL_FILTERS.map(f => ({ asset_url: f })) },
  });

  const avatars = await DB_CLIENT.use.stylistAccount.updateMany({
    where: { OR: REMOVED_URL_FILTERS.map(f => ({ avatar_url: f })) },
    data: { avatar_url: null, avatar_public_id: null },
  });
  const images = await DB_CLIENT.use.user.updateMany({
    where: { OR: REMOVED_URL_FILTERS.map(f => ({ image: f })) },
    data: { image: null },
  });
  const personAvatars = await DB_CLIENT.use.user.updateMany({
    where: { OR: REMOVED_URL_FILTERS.map(f => ({ avatar_url: f })) },
    data: { avatar_url: null, avatar_public_id: null },
  });
  const salonLogos = await DB_CLIENT.use.stylistAccount.updateMany({
    where: { OR: REMOVED_URL_FILTERS.map(f => ({ salon_logo_url: f })) },
    data: { salon_logo_url: null, salon_logo_public_id: null },
  });

  const touched =
    galleryDeleted +
    visitPhotos.count +
    avatars.count +
    images.count +
    personAvatars.count +
    salonLogos.count;
  if (touched > 0) {
    results.push(
      `Demo removed assets purged (gallery ${galleryDeleted}, visit photos ${visitPhotos.count}, avatars ${avatars.count + images.count + personAvatars.count}, salon logos ${salonLogos.count})`
    );
  }
};

/**
 * Restores the demo salon roster to what the seed creates.
 *
 * DECISION: the seed is find-or-create, so anything tests or manual reviews added to the demo salon
 * through the real invitation flow stayed and showed up in screenshots. The seed creates only the
 * DEMO_SALON_STAFF members, with no invitations, no salon-derived pairs (salon_origin_account_id) and no
 * staff sessions, so every run deletes the rest: foreign memberships, all salon invitations, derived
 * pairs (messages cascade) and sessions with staff accounts. Same gate as the seed, never production.
 */
export const pruneDemoSalonRoster_IO = async ({
  ownerAccountId,
  staffUserIds,
  staffAccountIds,
  results,
}: {
  ownerAccountId: string;
  staffUserIds: readonly string[];
  staffAccountIds: readonly string[];
  results: string[];
}): Promise<void> => {
  const memberships = await DB_CLIENT.use.staffMember.deleteMany({
    where: {
      stylist_account_id: ownerAccountId,
      user_id: { notIn: [...staffUserIds] },
    },
  });
  const invitations = await DB_CLIENT.use.salonInvitation.deleteMany({
    where: { salon_account_id: ownerAccountId },
  });
  const pairs = await DB_CLIENT.use.clientStylistPair.deleteMany({
    where: { salon_origin_account_id: ownerAccountId },
  });
  const sessions =
    staffAccountIds.length === 0
      ? { count: 0 }
      : await DB_CLIENT.use.sessionContainer.deleteMany({
          where: { stylist_account_id: { in: [...staffAccountIds] } },
        });

  const touched =
    memberships.count + invitations.count + pairs.count + sessions.count;
  if (touched > 0) {
    results.push(
      `Demo salon roster pruned (memberships ${memberships.count}, invitations ${invitations.count}, salon-derived pairs ${pairs.count}, staff sessions ${sessions.count})`
    );
  }
};
