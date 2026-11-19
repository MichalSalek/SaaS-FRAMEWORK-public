// asset-ownership-allow: the demo showcase builds URLs from its own photo bank
// (demo-content-seeding.bank.ts; an unknown name throws), never from a request
// body. There is no client input for the ownership gate to check. The seed
// also refuses to run outside dev/staging (demo-content-seeding.guard.ts).
import { DB_CLIENT } from '@app/db/db.client';
import { extractPublicIdFromUrl } from '@app/cloudinary/cloudinary-url.utils';
import { TIME } from '@kernel/application/constants.config';
import { VisitRecordSourceValue } from '@kernel/models/db_models.generated.dto';
import {
  RETIRED_SERVICE_NOTES,
  SERVICE_NOTE_TEMPLATES,
  type DemoVisitSpec,
} from './demo-content-seeding.clients-data';

export interface VisitTarget {
  clientUserId: string;
  stylistAccountId: string;
  visits: readonly DemoVisitSpec[];
}

const dayFloor = (date: Date): Date => {
  const floored = new Date(date);
  floored.setUTCHours(0, 0, 0, 0);
  return floored;
};

// DECISION: VisitRecord daysAgo counts from a fixed anchor, not from the per-run `now` (unlike
// gallery and sessions, which refresh every run). With a runtime `now`, the daily idempotency key
// (client + stylist + day) stops matching stored rows after a dev restart on another day and every
// run inserts a shifted duplicate visit. A visit is a historical fact, so a fixed date is correct.
const VISIT_EPOCH = new Date('2026-09-14T00:00:00.000Z');

export const seedVisits_IO = async ({
  targets,
  galleryIdByAssetUrl,
}: {
  targets: readonly VisitTarget[];
  galleryIdByAssetUrl: Map<string, string>;
}): Promise<{ visitsCreated: number; photosCreated: number }> => {
  const galleryEntries = [...galleryIdByAssetUrl.entries()];
  if (galleryEntries.length === 0 || targets.length === 0) {
    return { visitsCreated: 0, photosCreated: 0 };
  }

  const clientUserIds = [...new Set(targets.map(t => t.clientUserId))];
  const stylistAccountIds = [...new Set(targets.map(t => t.stylistAccountId))];

  const existing = await DB_CLIENT.use.visitRecord.findMany({
    where: {
      client_user_id: { in: clientUserIds },
      stylist_account_id: { in: stylistAccountIds },
    },
    select: {
      client_user_id: true,
      stylist_account_id: true,
      visit_date: true,
    },
  });
  const existingKeys = new Set(
    existing.map(
      v =>
        `${v.client_user_id}|${v.stylist_account_id}|${dayFloor(v.visit_date).getTime()}`
    )
  );

  type PlannedVisit = {
    key: string;
    clientUserId: string;
    stylistAccountId: string;
    visitDate: Date;
    serviceNote: string;
    resultPhotoCount: 1 | 2;
  };
  const specified: PlannedVisit[] = [];
  for (const target of targets) {
    for (const visit of target.visits) {
      const visitDate = dayFloor(
        new Date(VISIT_EPOCH.getTime() - visit.daysAgo * TIME.MS_PER_DAY)
      );
      const key = `${target.clientUserId}|${target.stylistAccountId}|${visitDate.getTime()}`;
      specified.push({
        key,
        clientUserId: target.clientUserId,
        stylistAccountId: target.stylistAccountId,
        visitDate,
        serviceNote:
          SERVICE_NOTE_TEMPLATES[
            visit.serviceNoteIndex % SERVICE_NOTE_TEMPLATES.length
          ] ?? 'Wizyta u stylistki.',
        resultPhotoCount: visit.resultPhotoCount,
      });
    }
  }

  const planned = specified.filter(p => !existingKeys.has(p.key));
  if (specified.length === 0) {
    return { visitsCreated: 0, photosCreated: 0 };
  }

  if (planned.length > 0) {
    await DB_CLIENT.use.visitRecord.createMany({
      data: planned.map(p => ({
        client_user_id: p.clientUserId,
        stylist_account_id: p.stylistAccountId,
        visit_date: p.visitDate,
        service_note: p.serviceNote,
        source: VisitRecordSourceValue.MANUAL,
      })),
      skipDuplicates: true,
    });
  }

  // DECISION: existing visits are never recreated (idempotency key = client, stylist, day), so a
  // visit still carrying a retired sentence (exact match in RETIRED_SERVICE_NOTES) gets its spec's
  // note. Notes typed by hand on dev are untouched; only rows with a retired seed sentence change.
  const existingSpecified = specified.filter(p => existingKeys.has(p.key));
  const notes = [...new Set(existingSpecified.map(p => p.serviceNote))];
  for (const note of notes) {
    await DB_CLIENT.use.visitRecord.updateMany({
      where: {
        service_note: { in: [...RETIRED_SERVICE_NOTES] },
        OR: existingSpecified
          .filter(p => p.serviceNote === note)
          .map(p => ({
            client_user_id: p.clientUserId,
            stylist_account_id: p.stylistAccountId,
            visit_date: p.visitDate,
          })),
      },
      data: { service_note: note },
    });
  }

  // Read every visit in range (not only ones just created), with result-photo
  // positions. After a file leaves the bank an existing visit has a hole, and
  // the showcase must match a clean seed.
  const allVisits = await DB_CLIENT.use.visitRecord.findMany({
    where: {
      client_user_id: { in: clientUserIds },
      stylist_account_id: { in: stylistAccountIds },
      visit_date: { in: specified.map(p => p.visitDate) },
    },
    select: {
      id: true,
      client_user_id: true,
      stylist_account_id: true,
      visit_date: true,
      result_photos: { select: { position: true, asset_url: true } },
    },
  });
  const visitByKey = new Map(
    allVisits.map(v => [
      `${v.client_user_id}|${v.stylist_account_id}|${dayFloor(v.visit_date).getTime()}`,
      v,
    ])
  );

  let cursor = 0;
  const photoRows: {
    visit_record_id: string;
    stylist_account_id: string;
    asset_url: string;
    public_id: string | null;
    position: number;
  }[] = [];
  for (const p of specified) {
    const visit = visitByKey.get(p.key);
    if (!visit) {
      continue;
    }
    const takenPositions = new Set(visit.result_photos.map(r => r.position));
    const usedUrls = new Set(visit.result_photos.map(r => r.asset_url));
    for (let position = 0; position < p.resultPhotoCount; position++) {
      if (takenPositions.has(position)) {
        continue;
      }
      // Rotate through the stylist's gallery, skipping photos already on this
      // visit (one visit does not show the same result twice).
      let assetUrl: string | undefined;
      for (let attempt = 0; attempt < galleryEntries.length; attempt++) {
        const [candidate] =
          galleryEntries[cursor % galleryEntries.length] ?? [];
        cursor++;
        if (candidate && !usedUrls.has(candidate)) {
          assetUrl = candidate;
          break;
        }
      }
      if (!assetUrl) {
        continue;
      }
      usedUrls.add(assetUrl);
      photoRows.push({
        visit_record_id: visit.id,
        stylist_account_id: p.stylistAccountId,
        asset_url: assetUrl,
        public_id: extractPublicIdFromUrl(assetUrl),
        position,
      });
    }
  }

  if (photoRows.length > 0) {
    await DB_CLIENT.use.visitResultPhoto.createMany({
      data: photoRows,
      skipDuplicates: true,
    });
  }

  return { visitsCreated: planned.length, photosCreated: photoRows.length };
};
