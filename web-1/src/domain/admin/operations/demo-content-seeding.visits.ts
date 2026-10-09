// asset-ownership-allow: wystawa demo składa adresy z WŁASNEGO banku zdjęć
// (demo-content-seeding.bank.ts, nazwa spoza banku rzuca), nigdy z ciała żądania —
// nie ma tu wejścia klienta, które bramka własności miałaby sprawdzać. Dodatkowo
// seed nie uruchamia się poza dev/stagingiem (demo-content-seeding.guard.ts).
import { DB_CLIENT } from '@app/db/db.client';
import { extractPublicIdFromUrl } from '@app/cloudinary/cloudinary-url.utils';
import { TIME } from '@kernel/application/constants.config';
import { VisitRecordSourceValue } from '@kernel/models/db_models.generated.dto';
import {
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

// DECISION (nie usuwaj tego komentarza) — S111: `daysAgo` w VisitRecord liczony
// od STAŁEJ kotwicy, NIE od `now` przekazywanego przy każdym seedzie (w
// przeciwieństwie do galerii/sesji, które celowo odświeżają się co run). Gdyby
// data wizyty zależała od runtime `now`, dobowy klucz idempotencji
// (client+stylist+dzień) przestałby pasować do już zapisanego wiersza po
// każdym restarcie dev-serwera na innym kalendarzowym dniu niż poprzedni seed
// — kolejny run tworzyłby DUPLIKAT tej samej wizyty przesunięty o różnicę dni,
// łamiąc twardy wymóg braku duplikatów. Wizyta to fakt historyczny (w
// przeciwieństwie do sesji SHARED, która musi wyglądać na żywą) — stałość jest
// tu poprawna, nie kompromisem.
const VISIT_EPOCH = new Date('2026-09-14T00:00:00.000Z');

/**
 * Bulk VisitRecord + VisitResultPhoto dla wielu klientek naraz (Karolina + 7
 * nowych) — fetch-existing → createMany zamiast upsertu w
 * pętli po dziesiątkach wierszy (AGENTS.md „PRISMA - PERFORMANCE").
 *
 * Idempotencja: naturalny klucz = (client_user_id, stylist_account_id,
 * visit_date zaokrąglone do północy UTC, liczone od VISIT_EPOCH — patrz
 * DECISION). Zdjęcia efektu ZAWSZE pochodzą z WŁASNEJ galerii tej stylistki
 * (ownership niezmiennik VisitResultPhoto) — rotowane po `galleryIdByAssetUrl`,
 * żeby wizyty nie powtarzały w kółko tego samego zdjęcia.
 */
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

  // Wizyty czytamy WSZYSTKIE z zakresu (nie tylko świeżo utworzone) razem z
  // pozycjami zdjęć efektu: po wycofaniu pliku z banku istniejąca wizyta zostaje
  // z dziurą, a wystawa ma wyglądać tak samo jak po czystym seedzie.
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
      // Rotacja po galerii stylistki, z pominięciem zdjęć już wiszących przy tej
      // wizycie (jedna wizyta nie pokazuje dwa razy tego samego efektu).
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
