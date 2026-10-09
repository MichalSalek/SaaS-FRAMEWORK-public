import { DB_CLIENT } from '@app/db/db.client';
import { requireDemoClient } from './demo-content-seeding.clients';
import {
  DEMO_SESSION_DRAFT_PHOTOS,
  DEMO_KAROLINA_EXTRA_ANIA_LIKES,
  DEMO_KAROLINA_OLA_LIKES,
  DEMO_KAROLINA_NINA_LIKES,
  resolveDemoAssetUrl,
} from './demo-content-seeding.config';
import { DEMO_NEW_CLIENTS } from './demo-content-seeding.clients-data';
import type { DemoClientAccounts } from './demo-content-seeding.clients';

/**
 * Bulk ulubione — bookmarki stylistek i lajki zdjęć. Oba modele mają unikalny
 * klucz (client_user_id, stylist_account_id) / (client_user_id, gallery_record_id),
 * więc zamiast upsertu w pętli: fetch-existing → createMany({skipDuplicates:true})
 * (AGENTS.md „PRISMA - PERFORMANCE").
 */
export const seedKarolinaFavorites_IO = async ({
  clientUserId,
  stylistAccountIds,
  galleryMaps,
  results,
}: {
  clientUserId: string;
  stylistAccountIds: { ania: string; ola: string; nina: string };
  galleryMaps: {
    ania: Map<string, string>;
    ola: Map<string, string>;
    nina: Map<string, string>;
  };
  results: string[];
}): Promise<void> => {
  const stylistIds = [
    stylistAccountIds.ania,
    stylistAccountIds.ola,
    stylistAccountIds.nina,
  ];
  const existingBookmarks = await DB_CLIENT.use.favoriteStylist.findMany({
    where: {
      client_user_id: clientUserId,
      stylist_account_id: { in: stylistIds },
    },
    select: { stylist_account_id: true },
  });
  const existingBookmarkSet = new Set(
    existingBookmarks.map(b => b.stylist_account_id)
  );
  const missingBookmarks = stylistIds.filter(
    id => !existingBookmarkSet.has(id)
  );
  if (missingBookmarks.length > 0) {
    await DB_CLIENT.use.favoriteStylist.createMany({
      data: missingBookmarks.map(stylist_account_id => ({
        client_user_id: clientUserId,
        stylist_account_id,
      })),
      skipDuplicates: true,
    });
    results.push(
      `Demo Karolina stylist bookmarks created (${missingBookmarks.length})`
    );
  }

  type LikeEntry = { recordId: string; note: string | null };
  const likeEntries: LikeEntry[] = [];

  for (const entry of [
    ...DEMO_SESSION_DRAFT_PHOTOS,
    ...DEMO_KAROLINA_EXTRA_ANIA_LIKES,
  ]) {
    const recordId = galleryMaps.ania.get(resolveDemoAssetUrl(entry.asset_url));
    if (recordId) {
      likeEntries.push({ recordId, note: entry.favorite_note });
    }
  }
  for (const url of DEMO_KAROLINA_OLA_LIKES) {
    const recordId = galleryMaps.ola.get(resolveDemoAssetUrl(url));
    if (recordId) {
      likeEntries.push({ recordId, note: null });
    }
  }
  for (const url of DEMO_KAROLINA_NINA_LIKES) {
    const recordId = galleryMaps.nina.get(resolveDemoAssetUrl(url));
    if (recordId) {
      likeEntries.push({ recordId, note: null });
    }
  }

  const existingLikes = await DB_CLIENT.use.favoriteGalleryRecord.findMany({
    where: {
      client_user_id: clientUserId,
      gallery_record_id: { in: likeEntries.map(e => e.recordId) },
    },
    select: { gallery_record_id: true },
  });
  const existingLikeSet = new Set(existingLikes.map(l => l.gallery_record_id));
  const missingLikes = likeEntries.filter(
    e => !existingLikeSet.has(e.recordId)
  );
  if (missingLikes.length > 0) {
    await DB_CLIENT.use.favoriteGalleryRecord.createMany({
      data: missingLikes.map(e => ({
        client_user_id: clientUserId,
        gallery_record_id: e.recordId,
        note: e.note,
      })),
      skipDuplicates: true,
    });
    results.push(
      `Demo Karolina gallery likes created (${missingLikes.length})`
    );
  }
};

/** Lajki dwóch nowych klientek (Aleksandra, Paulina) na galerii Ani, bez notek. */
export const seedNewClientLikes_IO = async ({
  clientsBySlug,
  aniaGalleryIdByUrl,
  results,
}: {
  clientsBySlug: Map<string, DemoClientAccounts>;
  aniaGalleryIdByUrl: Map<string, string>;
  results: string[];
}): Promise<void> => {
  const rows: { client_user_id: string; gallery_record_id: string }[] = [];
  for (const spec of DEMO_NEW_CLIENTS) {
    if (!spec.likesOnAniaGallery) {
      continue;
    }
    const client = requireDemoClient(clientsBySlug, spec.slug);
    for (const url of spec.likesOnAniaGallery) {
      const recordId = aniaGalleryIdByUrl.get(resolveDemoAssetUrl(url));
      if (recordId) {
        rows.push({
          client_user_id: client.userId,
          gallery_record_id: recordId,
        });
      }
    }
  }
  if (rows.length === 0) {
    return;
  }

  const existing = await DB_CLIENT.use.favoriteGalleryRecord.findMany({
    where: {
      client_user_id: { in: rows.map(r => r.client_user_id) },
      gallery_record_id: { in: rows.map(r => r.gallery_record_id) },
    },
    select: { client_user_id: true, gallery_record_id: true },
  });
  const existingSet = new Set(
    existing.map(e => `${e.client_user_id}::${e.gallery_record_id}`)
  );
  const missing = rows.filter(
    r => !existingSet.has(`${r.client_user_id}::${r.gallery_record_id}`)
  );
  if (missing.length > 0) {
    await DB_CLIENT.use.favoriteGalleryRecord.createMany({
      data: missing.map(r => ({ ...r, note: null })),
      skipDuplicates: true,
    });
    results.push(`Demo new-client gallery likes created (${missing.length})`);
  }
};
