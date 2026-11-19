// asset-ownership-allow: the demo showcase builds URLs from its own photo bank
// (demo-content-seeding.bank.ts; a name outside the bank throws), never from the
// request body. There is no client input for the ownership gate to check. The
// seed also never runs outside dev/staging (demo-content-seeding.guard.ts).
import { DB_CLIENT } from '@app/db/db.client';
import { extractPublicIdFromUrl } from '@app/cloudinary/cloudinary-url.utils';
import { TIME } from '@kernel/application/constants.config';
import type { DemoPhoto } from './demo-content-seeding.photos';
import { resolveDemoAssetUrl } from './demo-content-seeding.config';
import { DEMO_BANK_ASSET_URLS } from './demo-content-seeding.bank';
import { deleteGalleryRecordsById_IO } from './demo-content-seeding.cleanup';

export const seedStylistGallery_IO = async ({
  stylistAccountId,
  photos,
  pinnedAssetUrls,
  colorByName,
  traitByName,
  now,
  ageOffsetDays = 0,
}: {
  stylistAccountId: string;
  photos: readonly DemoPhoto[];
  pinnedAssetUrls: readonly string[];
  colorByName: Map<string, string>;
  traitByName: Map<string, string>;
  now: Date;
  /** Ages the whole gallery by N days, so new accounts stay off the top of the feed. */
  ageOffsetDays?: number;
}): Promise<{ galleryIdByAssetUrl: Map<string, string>; created: number }> => {
  const normalizedPhotos = photos.map((photo, index) => ({
    ...photo,
    asset_url: resolveDemoAssetUrl(photo.asset_url),
    index,
  }));

  const existing = await DB_CLIENT.use.galleryRecord.findMany({
    where: { created_by_account_id: stylistAccountId },
    select: { gallery_record_id: true, asset_url: true },
  });

  // A work moved to another stylist, or dropped from her set, must leave this
  // account, or the database drifts from a clean seed on every reassignment.
  // Only demo-bank photos are deleted. Hand QA uploads on the demo account stay.
  const specUrls = new Set(normalizedPhotos.map(p => p.asset_url));
  const stale = existing.filter(
    r => DEMO_BANK_ASSET_URLS.has(r.asset_url) && !specUrls.has(r.asset_url)
  );
  if (stale.length > 0) {
    await deleteGalleryRecordsById_IO(stale.map(r => r.gallery_record_id));
  }

  const existingUrls = new Set(
    existing.filter(r => !stale.includes(r)).map(r => r.asset_url)
  );

  const missing = normalizedPhotos.filter(p => !existingUrls.has(p.asset_url));

  if (missing.length > 0) {
    await DB_CLIENT.use.galleryRecord.createMany({
      data: missing.map(p => ({
        created_by_account_id: stylistAccountId,
        asset_url: p.asset_url,
        public_id: extractPublicIdFromUrl(p.asset_url),
        nail_length: p.nail_length,
        is_pinned: false,
        // Staggerowane created_at: zdjęcie o wyższym indeksie w banku jest
        // "starsze" o 1.5 dnia, żeby porządek i meta ("ostatnia wczoraj")
        // wyglądały naturalnie zamiast identycznego timestampu z jednej transakcji.
        created_at: new Date(
          now.getTime() - (ageOffsetDays + p.index * 1.5) * TIME.MS_PER_DAY
        ),
      })),
      skipDuplicates: true,
    });
  }

  const allRecords = await DB_CLIENT.use.galleryRecord.findMany({
    where: { created_by_account_id: stylistAccountId },
    select: { gallery_record_id: true, asset_url: true },
  });
  // The map holds only photos from the demo bank. A demo account is sometimes
  // used for a hand QA upload, and its gallery then collects test files. Sessions,
  // visits and likes walk this map, so without the filter the showcase showed
  // „sample-crop" as a visit-result photo.
  const bankUrls = new Set(normalizedPhotos.map(p => p.asset_url));
  const galleryIdByAssetUrl = new Map(
    allRecords
      .filter(r => bankUrls.has(r.asset_url))
      .map(r => [r.asset_url, r.gallery_record_id])
  );

  // DECISION: colors, traits and nail length are reconciled for EVERY spec record, not only new ones.
  // Written on create only, a bank metadata fix never reached a DB the seed had already seeded, so
  // dev/staging (where UI vote screenshots come from) showed stale tags and the color filter lied.
  // The junction tables are small and have @@unique([gallery_record_id, *_id]), so delete-and-recreate
  // is cheap and exact.
  const specRecordIds = normalizedPhotos
    .map(p => galleryIdByAssetUrl.get(p.asset_url))
    .filter((id): id is string => id !== undefined);

  if (specRecordIds.length > 0) {
    const colorRows: { gallery_record_id: string; color_id: string }[] = [];
    const traitRows: { gallery_record_id: string; trait_id: string }[] = [];
    for (const p of normalizedPhotos) {
      const recordId = galleryIdByAssetUrl.get(p.asset_url);
      if (!recordId) {
        continue;
      }
      for (const colorName of p.colors) {
        const colorId = colorByName.get(colorName);
        // Nazwa spoza slownika RZUCA, tak samo jak nazwa pliku spoza banku
        // (demo-content-seeding.bank.ts): literowka w danych ma wybuchnac, a nie
        // po cichu zostawic zdjecie bez tagu, ktorego nikt juz nie szuka.
        if (colorId === undefined) {
          throw new Error(
            `Demo seed: kolor "${colorName}" (${p.asset_url}) nie istnieje w slowniku kolorow`
          );
        }
        colorRows.push({ gallery_record_id: recordId, color_id: colorId });
      }
      for (const traitName of p.traits) {
        const traitId = traitByName.get(traitName);
        if (traitId === undefined) {
          throw new Error(
            `Demo seed: cecha "${traitName}" (${p.asset_url}) nie istnieje w slowniku cech`
          );
        }
        traitRows.push({ gallery_record_id: recordId, trait_id: traitId });
      }
    }

    // Najpierw zdejmujemy to, czego w specyfikacji juz nie ma (inaczej tag usuniety
    // z banku zostawalby na zdjeciu na zawsze), potem dokladamy komplet.
    await DB_CLIENT.use.galleryRecordColor.deleteMany({
      where: { gallery_record_id: { in: specRecordIds } },
    });
    await DB_CLIENT.use.galleryRecordTrait.deleteMany({
      where: { gallery_record_id: { in: specRecordIds } },
    });
    if (colorRows.length > 0) {
      await DB_CLIENT.use.galleryRecordColor.createMany({
        data: colorRows,
        skipDuplicates: true,
      });
    }
    if (traitRows.length > 0) {
      await DB_CLIENT.use.galleryRecordTrait.createMany({
        data: traitRows,
        skipDuplicates: true,
      });
    }

    // Dlugosc paznokcia rowniez byla pisana tylko przy tworzeniu wiersza. Jedno
    // `updateMany` na grupe (dlugosci sa cztery), a nie zapis na rekord.
    const idsByNailLength = new Map<DemoPhoto['nail_length'], string[]>();
    for (const p of normalizedPhotos) {
      const recordId = galleryIdByAssetUrl.get(p.asset_url);
      if (recordId === undefined) {
        continue;
      }
      const group = idsByNailLength.get(p.nail_length);
      if (group === undefined) {
        idsByNailLength.set(p.nail_length, [recordId]);
      } else {
        group.push(recordId);
      }
    }
    for (const [nailLength, ids] of idsByNailLength) {
      await DB_CLIENT.use.galleryRecord.updateMany({
        where: {
          gallery_record_id: { in: ids },
          NOT: { nail_length: nailLength },
        },
        data: { nail_length: nailLength },
      });
    }
  }

  const normalizedPinned = new Set(
    pinnedAssetUrls.map(url => resolveDemoAssetUrl(url))
  );
  const pinnedIds = [...galleryIdByAssetUrl.entries()]
    .filter(([url]) => normalizedPinned.has(url))
    .map(([, id]) => id);

  if (pinnedIds.length > 0) {
    await DB_CLIENT.use.galleryRecord.updateMany({
      where: {
        created_by_account_id: stylistAccountId,
        gallery_record_id: { in: pinnedIds },
        is_pinned: false,
      },
      data: { is_pinned: true },
    });
  }
  await DB_CLIENT.use.galleryRecord.updateMany({
    where: {
      created_by_account_id: stylistAccountId,
      gallery_record_id: { notIn: pinnedIds },
      is_pinned: true,
    },
    // Same invariant as unpinGalleryRecord_IO: an unpinned work has no position.
    // Seeded pins keep NULL and fall back to newest-first on public reads.
    data: { is_pinned: false, pinned_position: null },
  });

  return { galleryIdByAssetUrl, created: missing.length };
};
