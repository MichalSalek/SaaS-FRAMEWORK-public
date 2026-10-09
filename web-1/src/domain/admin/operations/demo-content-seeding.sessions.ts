import { DB_CLIENT } from '@app/db/db.client';
import { requireDemoClient } from './demo-content-seeding.clients';
import { isP2002 } from '@app/db/prisma-error';
import { TIME } from '@kernel/application/constants.config';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import {
  DEMO_GALLERY,
  DEMO_SESSION_SHARED,
  DEMO_SESSION_SHARED_EXTRA_PHOTO,
  DEMO_SESSION_CLOSED,
  DEMO_SESSION_CLOSED_EXTRA_PHOTO,
  DEMO_SESSION_DRAFT_NAME,
  DEMO_SESSION_DRAFT_PHOTOS,
  DEMO_SESSION_OLA,
  DEMO_SESSION_OLA_PHOTOS,
  resolveDemoAssetUrl,
} from './demo-content-seeding.config';
import { DEMO_NEW_CLIENTS } from './demo-content-seeding.clients-data';
import type { DemoClientAccounts } from './demo-content-seeding.clients';

const DAY_MS = TIME.MS_PER_DAY;

/**
 * Dopina zdjęcia do sesji. Pozycja jest unikalna w obrębie sesji
 * (@@unique[session_id, position]), a po wycofaniu zdjęć z banku miejsca w
 * istniejących sesjach bywają już zajęte przez zdjęcia, które zostały —
 * dlatego żądana pozycja jest brana tylko wtedy, gdy jest wolna, a w przeciwnym
 * razie bierzemy pierwszą wolną. Bez tego ponowny seed leciał na P2002.
 */
export const attachPhotos = async (
  sessionId: string,
  recordIds: readonly string[]
) => {
  const existingPhotos = await DB_CLIENT.use.sessionContainerPhoto.findMany({
    where: { session_id: sessionId },
    select: { gallery_record_id: true, position: true },
  });
  const existingIds = new Set(existingPhotos.map(p => p.gallery_record_id));
  const takenPositions = new Set(existingPhotos.map(p => p.position));

  for (const [desiredPosition, recordId] of recordIds.entries()) {
    if (existingIds.has(recordId)) {
      continue;
    }
    let position = desiredPosition;
    while (takenPositions.has(position)) {
      position++;
    }
    takenPositions.add(position);
    existingIds.add(recordId);
    await DB_CLIENT.use.sessionContainerPhoto.create({
      data: { session_id: sessionId, gallery_record_id: recordId, position },
    });
  }
};

const resolveIds = (
  urls: readonly string[],
  galleryIdByAssetUrl: Map<string, string>
): string[] =>
  urls
    .map(url => galleryIdByAssetUrl.get(resolveDemoAssetUrl(url)))
    .filter((id): id is string => Boolean(id));

/**
 * Trzy sesje demo-duo (Ania↔Karolina) — SHARED/CLOSED rozszerzone o jedno
 * dodatkowe zdjęcie ponad oryginalną trójkę/dwójkę, DRAFT dostaje komplet 4
 * zdjęć (te same, które Karolina lajkuje z notką — demo-content-seeding.config).
 */
export const ensureAniaSessions_IO = async ({
  stylistAccountId,
  clientAccountId,
  galleryIdByAssetUrl,
  now,
  results,
}: {
  stylistAccountId: string;
  clientAccountId: string;
  galleryIdByAssetUrl: Map<string, string>;
  now: Date;
  results: string[];
}): Promise<void> => {
  const sharedPhotoUrls = [
    ...DEMO_GALLERY.filter(e => typeof e.shared_session_position === 'number')
      .sort(
        (a, b) =>
          (a.shared_session_position ?? 0) - (b.shared_session_position ?? 0)
      )
      .map(e => e.asset_url),
    DEMO_SESSION_SHARED_EXTRA_PHOTO,
  ];
  const closedPhotoUrls = [
    ...DEMO_GALLERY.filter(e => typeof e.closed_session_position === 'number')
      .sort(
        (a, b) =>
          (a.closed_session_position ?? 0) - (b.closed_session_position ?? 0)
      )
      .map(e => e.asset_url),
    DEMO_SESSION_CLOSED_EXTRA_PHOTO,
  ];

  // SHARED — refresh okna 7 dni przy KAŻDYM seedzie (parytet z oryginałem).
  let sharedSession = await DB_CLIENT.use.sessionContainer.findFirst({
    where: {
      client_account_id: clientAccountId,
      name: DEMO_SESSION_SHARED.name,
    },
  });
  try {
    if (!sharedSession) {
      sharedSession = await DB_CLIENT.use.sessionContainer.create({
        data: {
          client_account_id: clientAccountId,
          stylist_account_id: stylistAccountId,
          name: DEMO_SESSION_SHARED.name,
          lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
          client_note: DEMO_SESSION_SHARED.client_note,
          stylist_note: DEMO_SESSION_SHARED.stylist_note,
          shared_at: now,
          expires_at: new Date(now.getTime() + 7 * DAY_MS),
        },
      });
      results.push('Demo session SHARED created');
    } else {
      sharedSession = await DB_CLIENT.use.sessionContainer.update({
        where: { id: sharedSession.id },
        data: {
          lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
          shared_at: now,
          expires_at: new Date(now.getTime() + 7 * DAY_MS),
        },
      });
    }
    await attachPhotos(
      sharedSession.id,
      resolveIds(sharedPhotoUrls, galleryIdByAssetUrl)
    );
  } catch (error) {
    // P2002 z partial-unique `session_container_active_pair_uq` — kanon stoi
    // w schema.prisma przy modelu SessionContainer (indeks tworzy raw-SQL
    // w ensure-db-indexes.ts, bo `db push` go nie aplikuje). Wczesniej ten
    // komentarz odsylal do DECISION w operations.ts, ktory o P2002 nie mowi nic.
    if (!isP2002(error)) {
      throw error;
    }
    results.push(
      'Demo session SHARED skipped (active session for pair already exists)'
    );
  }

  // CLOSED — archiwalna.
  let closedSession = await DB_CLIENT.use.sessionContainer.findFirst({
    where: {
      client_account_id: clientAccountId,
      name: DEMO_SESSION_CLOSED.name,
    },
  });
  if (!closedSession) {
    closedSession = await DB_CLIENT.use.sessionContainer.create({
      data: {
        client_account_id: clientAccountId,
        stylist_account_id: stylistAccountId,
        name: DEMO_SESSION_CLOSED.name,
        lifecycle_state: SessionContainerLifecycleStateValue.CLOSED,
        stylist_note: DEMO_SESSION_CLOSED.stylist_note,
        shared_at: new Date(now.getTime() - 21 * DAY_MS),
        expires_at: new Date(now.getTime() - 14 * DAY_MS),
        closed_at: new Date(now.getTime() - 14 * DAY_MS),
      },
    });
    results.push('Demo session CLOSED created');
  }
  await attachPhotos(
    closedSession.id,
    resolveIds(closedPhotoUrls, galleryIdByAssetUrl)
  );

  // DRAFT — bez stylistki, 4 zdjęcia lajkowane przez Karolinę.
  const draftPhotoIds = resolveIds(
    DEMO_SESSION_DRAFT_PHOTOS.map(p => p.asset_url),
    galleryIdByAssetUrl
  );
  let draftSession = await DB_CLIENT.use.sessionContainer.findFirst({
    where: {
      client_account_id: clientAccountId,
      name: DEMO_SESSION_DRAFT_NAME,
    },
  });
  if (!draftSession) {
    draftSession = await DB_CLIENT.use.sessionContainer.create({
      data: {
        client_account_id: clientAccountId,
        name: DEMO_SESSION_DRAFT_NAME,
        lifecycle_state: SessionContainerLifecycleStateValue.DRAFT,
      },
    });
    results.push('Demo session DRAFT created');
  }
  await attachPhotos(draftSession.id, draftPhotoIds);
};

/** Sesja SHARED Karolina↔Ola ("Na wesele siostry"). */
export const ensureOlaSharedSession_IO = async ({
  stylistAccountId,
  clientAccountId,
  galleryIdByAssetUrl,
  now,
  results,
}: {
  stylistAccountId: string;
  clientAccountId: string;
  galleryIdByAssetUrl: Map<string, string>;
  now: Date;
  results: string[];
}): Promise<void> => {
  let session = await DB_CLIENT.use.sessionContainer.findFirst({
    where: { client_account_id: clientAccountId, name: DEMO_SESSION_OLA.name },
  });
  try {
    if (!session) {
      session = await DB_CLIENT.use.sessionContainer.create({
        data: {
          client_account_id: clientAccountId,
          stylist_account_id: stylistAccountId,
          name: DEMO_SESSION_OLA.name,
          lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
          client_note: DEMO_SESSION_OLA.client_note,
          stylist_note: DEMO_SESSION_OLA.stylist_note,
          shared_at: now,
          expires_at: new Date(now.getTime() + 7 * DAY_MS),
        },
      });
      results.push('Demo session SHARED (Ola) created');
    } else {
      session = await DB_CLIENT.use.sessionContainer.update({
        where: { id: session.id },
        data: {
          lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
          shared_at: now,
          expires_at: new Date(now.getTime() + 7 * DAY_MS),
        },
      });
    }
    await attachPhotos(
      session.id,
      resolveIds(DEMO_SESSION_OLA_PHOTOS, galleryIdByAssetUrl)
    );
  } catch (error) {
    if (!isP2002(error)) {
      throw error;
    }
    results.push(
      'Demo session SHARED (Ola) skipped (active session for pair already exists)'
    );
  }
};

/** Sesje SHARED trzech nowych klientek z Anią (Julia, Natalia, Weronika). */
export const ensureNewClientSharedSessions_IO = async ({
  stylistAccountId,
  clientsBySlug,
  galleryIdByAssetUrl,
  now,
  results,
}: {
  stylistAccountId: string;
  clientsBySlug: Map<string, DemoClientAccounts>;
  galleryIdByAssetUrl: Map<string, string>;
  now: Date;
  results: string[];
}): Promise<void> => {
  for (const spec of DEMO_NEW_CLIENTS) {
    const sharedSpec = spec.sharedSession;
    // Brak `sharedSession` jest LEGALNY (nie kazda klientka demo ma sesje);
    // brak KONTA klientki juz nie — patrz DECISION przy requireDemoClient.
    if (!sharedSpec) {
      continue;
    }
    const client = requireDemoClient(clientsBySlug, spec.slug);
    let session = await DB_CLIENT.use.sessionContainer.findFirst({
      where: {
        client_account_id: client.clientAccountId,
        name: sharedSpec.name,
      },
    });
    try {
      if (!session) {
        session = await DB_CLIENT.use.sessionContainer.create({
          data: {
            client_account_id: client.clientAccountId,
            stylist_account_id: stylistAccountId,
            name: sharedSpec.name,
            lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
            client_note: sharedSpec.clientNote,
            shared_at: now,
            expires_at: new Date(now.getTime() + 7 * DAY_MS),
          },
        });
        results.push(`Demo session SHARED (${spec.displayName}) created`);
      } else {
        session = await DB_CLIENT.use.sessionContainer.update({
          where: { id: session.id },
          data: {
            lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
            shared_at: now,
            expires_at: new Date(now.getTime() + 7 * DAY_MS),
          },
        });
      }
      await attachPhotos(
        session.id,
        resolveIds(sharedSpec.photoUrls, galleryIdByAssetUrl)
      );
    } catch (error) {
      if (!isP2002(error)) {
        throw error;
      }
      results.push(
        `Demo session SHARED (${spec.displayName}) skipped (active session for pair already exists)`
      );
    }
  }
};
