import { DB_CLIENT } from '@app/db/db.client';
import { isP2002 } from '@app/db/prisma-error';
import { TIME } from '@kernel/application/constants.config';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import { resolveDemoAssetUrl } from './demo-content-seeding.config';
import { demoPhotoBaseName } from './demo-content-seeding.bank';
import type { DemoClientAccounts } from './demo-content-seeding.clients';
import type { DemoStylistAnchor } from './demo-content-seeding.community';
import {
  DEMO_COMMUNITY_BROWSING,
  DEMO_COMMUNITY_PAIRS,
  type DemoCommunityPairSpec,
  type DemoCommunitySessionSpec,
} from './demo-content-seeding.community-data';
import { attachPhotos } from './demo-content-seeding.sessions';
import {
  seedMessageThreads_IO,
  type MessageThreadTarget,
} from './demo-content-seeding.messages';
import { seedVisits_IO } from './demo-content-seeding.visits';

const DAY_MS = TIME.MS_PER_DAY;
/** Okno sesji udostępnionej (parytet z sesjami SHARED wystawy S111). */
const SHARE_WINDOW_DAYS = 7;

interface RelationsInput {
  now: Date;
  results: string[];
  stylists: Map<string, DemoStylistAnchor>;
  clients: Map<string, DemoClientAccounts>;
}

/**
 * id rekordu galerii dla zdjęcia TEJ stylistki, wskazanego nazwą pliku. Nazwa
 * spoza jej galerii rzuca: cicha undefined gubiła lajk albo zdjęcie sesji przy
 * każdej zmianie banku (2026-09-16), a dane mają być głośno spójne.
 *
 * OBIE drogi chybienia rzucaja, nie tylko pierwsza: sprawdzenie specyfikacji bylo
 * glosne, ale odczyt z mapy oddawal `undefined`, ktore wszyscy trzej wolajacy
 * po cichu pomijali — czyli funkcja nadal gubila lajk albo zdjecie sesji, wbrew
 * wlasnemu opisowi. Mape buduje ten sam przebieg seeda z tej samej specyfikacji,
 * wiec chybienie jest zlamanym niezmiennikiem, a nie brakiem danych.
 */
export const photoRecordId = (
  stylist: DemoStylistAnchor,
  photoName: string
): string => {
  const photo = stylist.photos.find(
    p => demoPhotoBaseName(p.asset_url) === photoName
  );
  if (!photo) {
    throw new Error(
      `Demo photo "${photoName}" is not in this stylist's gallery spec`
    );
  }
  const recordId = stylist.galleryIdByAssetUrl.get(
    resolveDemoAssetUrl(photo.asset_url)
  );
  if (recordId === undefined) {
    throw new Error(
      `Demo photo "${photoName}" has no gallery row after seeding this stylist`
    );
  }
  return recordId;
};

const pairKey = (clientUserId: string, stylistAccountId: string) =>
  `${clientUserId}|${stylistAccountId}`;

/**
 * Deterministyczny token historycznego kodu QR (VarChar(32) @unique). Sesja
 * jest od razu ODEBRANA i WYGASŁA, więc tokenu nie da się użyć ponownie; stała
 * wartość jest kluczem idempotencji. Prawdziwe tokeny to 128 bitów CSPRNG.
 */
const qrToken = (spec: DemoCommunityPairSpec) =>
  `demo-qr-${spec.clientSlug}-${spec.stylistSlug}`.slice(0, 32);

type ResolvedPair = DemoCommunityPairSpec & {
  client: DemoClientAccounts;
  stylist: DemoStylistAnchor;
};

const ensurePairs_IO = async (
  pairs: readonly ResolvedPair[],
  now: Date,
  results: string[]
): Promise<void> => {
  const where = pairs.map(p => ({
    client_user_id: p.client.userId,
    stylist_account_id: p.stylist.accountId,
  }));
  const existing = await DB_CLIENT.use.clientStylistPair.findMany({
    where: { OR: where },
    select: { client_user_id: true, stylist_account_id: true },
  });
  const existingKeys = new Set(
    existing.map(e => pairKey(e.client_user_id, e.stylist_account_id))
  );
  const missing = pairs.filter(
    p => !existingKeys.has(pairKey(p.client.userId, p.stylist.accountId))
  );

  const pairedAt = (p: ResolvedPair) =>
    new Date(now.getTime() - p.pairedDaysAgo * DAY_MS);

  const qrPairs = missing.filter(p => p.viaQr);
  if (qrPairs.length > 0) {
    await DB_CLIENT.use.pairingSession.createMany({
      data: qrPairs.map(p => ({
        token: qrToken(p),
        stylist_account_id: p.stylist.accountId,
        issued_by_user_id: p.stylist.userId,
        created_at: new Date(pairedAt(p).getTime() - 2 * TIME.MS_PER_MINUTE),
        expires_at: new Date(pairedAt(p).getTime() + 13 * TIME.MS_PER_MINUTE),
        claimed_by_client_user_id: p.client.userId,
        claimed_at: pairedAt(p),
      })),
      skipDuplicates: true,
    });
  }
  const qrSessions = await DB_CLIENT.use.pairingSession.findMany({
    where: { token: { in: qrPairs.map(qrToken) } },
    select: { id: true, token: true },
  });
  const qrSessionIdByToken = new Map(qrSessions.map(s => [s.token, s.id]));

  if (missing.length > 0) {
    await DB_CLIENT.use.clientStylistPair.createMany({
      data: missing.map(p => ({
        client_user_id: p.client.userId,
        stylist_account_id: p.stylist.accountId,
        status: p.status,
        paired_at: pairedAt(p),
        paired_via_pairing_session_id: p.viaQr
          ? (qrSessionIdByToken.get(qrToken(p)) ?? null)
          : null,
        crm_note: p.crmNote ?? null,
        crm_note_updated_at: p.crmNote
          ? new Date(pairedAt(p).getTime() + DAY_MS)
          : null,
        revoked_at: p.revoked
          ? new Date(now.getTime() - p.revoked.daysAgo * DAY_MS)
          : null,
        revoked_by: p.revoked?.by ?? null,
      })),
      skipDuplicates: true,
    });
    results.push(`Demo community pairs created (${missing.length})`);
  }

  const all = await DB_CLIENT.use.clientStylistPair.findMany({
    where: { OR: where },
    select: {
      id: true,
      client_user_id: true,
      stylist_account_id: true,
      status: true,
    },
  });
  const byKey = new Map(
    all.map(a => [pairKey(a.client_user_id, a.stylist_account_id), a])
  );

  // Self-heal statusu (np. ktoś ręcznie zerwał parę podczas klikania).
  // Pętla wyłącznie po parach z rozjechanym statusem, zwykle zero iteracji.
  for (const p of pairs) {
    const row = byKey.get(pairKey(p.client.userId, p.stylist.accountId));
    if (row && row.status !== p.status) {
      await DB_CLIENT.use.clientStylistPair.update({
        where: { id: row.id },
        data: {
          status: p.status,
          revoked_at: p.revoked
            ? new Date(now.getTime() - p.revoked.daysAgo * DAY_MS)
            : null,
          revoked_by: p.revoked?.by ?? null,
        },
      });
      results.push(
        `Demo community pair re-pinned (${p.clientSlug}/${p.stylistSlug})`
      );
    }
  }
};

const ensureSession_IO = async (
  pair: ResolvedPair,
  spec: DemoCommunitySessionSpec,
  now: Date,
  results: string[]
): Promise<void> => {
  const photoIds = spec.photos.map(name => photoRecordId(pair.stylist, name));
  let session = await DB_CLIENT.use.sessionContainer.findFirst({
    where: { client_account_id: pair.client.clientAccountId, name: spec.name },
    select: { id: true },
  });
  if (!session) {
    const sharedAt =
      spec.sharedDaysAgo === undefined
        ? null
        : new Date(now.getTime() - spec.sharedDaysAgo * DAY_MS);
    const expiresAt = sharedAt
      ? new Date(sharedAt.getTime() + SHARE_WINDOW_DAYS * DAY_MS)
      : null;
    try {
      session = await DB_CLIENT.use.sessionContainer.create({
        data: {
          client_account_id: pair.client.clientAccountId,
          stylist_account_id: pair.stylist.accountId,
          name: spec.name,
          lifecycle_state: spec.state,
          client_note: spec.clientNote ?? null,
          stylist_note: spec.stylistNote ?? null,
          shared_at: sharedAt,
          expires_at: expiresAt,
          closed_at:
            spec.state === SessionContainerLifecycleStateValue.CLOSED
              ? expiresAt
              : null,
        },
        select: { id: true },
      });
      results.push(`Demo session ${spec.state} created (${spec.name})`);
    } catch (error) {
      // Partial-unique active_pair: para ma już inną niezakończoną sesję
      // (np. utworzoną ręcznie podczas klikania). Nie nadpisujemy cudzej pracy.
      if (!isP2002(error)) {
        throw error;
      }
      results.push(`Demo session ${spec.name} skipped (active session exists)`);
      return;
    }
  }
  await attachPhotos(session.id, photoIds);
};

const seedFavorites_IO = async (
  pairs: readonly ResolvedPair[],
  input: RelationsInput
): Promise<void> => {
  const browsing = DEMO_COMMUNITY_BROWSING.flatMap(b => {
    const client = input.clients.get(b.clientSlug);
    const stylist = input.stylists.get(b.stylistSlug);
    return client && stylist ? [{ ...b, client, stylist, bookmark: true }] : [];
  });
  const sources = [...pairs, ...browsing];

  const bookmarkRows = sources
    .filter(s => s.bookmark)
    .map(s => ({
      client_user_id: s.client.userId,
      stylist_account_id: s.stylist.accountId,
    }));
  const likeRows = sources.flatMap(s =>
    (s.likes ?? []).map(like => ({
      client_user_id: s.client.userId,
      gallery_record_id: photoRecordId(s.stylist, like.photo),
      note: like.note,
    }))
  );

  // Oba modele mają @@unique na parze kluczy, więc skipDuplicates daje
  // idempotencję bez upsertu w pętli (AGENTS.md „PRISMA - PERFORMANCE").
  const bookmarks = await DB_CLIENT.use.favoriteStylist.createMany({
    data: bookmarkRows,
    skipDuplicates: true,
  });
  const likes = await DB_CLIENT.use.favoriteGalleryRecord.createMany({
    data: likeRows,
    skipDuplicates: true,
  });
  if (bookmarks.count > 0 || likes.count > 0) {
    input.results.push(
      `Demo community favorites created (${bookmarks.count} bookmarks, ${likes.count} likes)`
    );
  }
};

export const seedCommunityRelations_IO = async (
  input: RelationsInput
): Promise<void> => {
  const { now, results, stylists, clients } = input;

  const pairs: ResolvedPair[] = DEMO_COMMUNITY_PAIRS.flatMap(spec => {
    const client = clients.get(spec.clientSlug);
    const stylist = stylists.get(spec.stylistSlug);
    if (!client || !stylist) {
      results.push(
        `Demo community pair skipped (unknown ${spec.clientSlug}/${spec.stylistSlug})`
      );
      return [];
    }
    return [{ ...spec, client, stylist }];
  });

  await ensurePairs_IO(pairs, now, results);

  const messageTargets: MessageThreadTarget[] = pairs
    .filter(p => p.messages && p.messages.length > 0)
    .map(p => ({
      clientUserId: p.client.userId,
      stylistAccountId: p.stylist.accountId,
      messages: p.messages ?? [],
      unreadFor: p.unreadFor ?? null,
    }));
  await seedMessageThreads_IO({ targets: messageTargets, now, results });

  // Wizyty per stylistka: zdjęcia efektu zawsze z JEJ galerii (niezmiennik
  // własności VisitResultPhoto, patrz demo-content-seeding.visits.ts).
  let visitsCreated = 0;
  for (const stylist of new Set(pairs.map(p => p.stylist))) {
    const targets = pairs
      .filter(p => p.stylist === stylist && p.visits && p.visits.length > 0)
      .map(p => ({
        clientUserId: p.client.userId,
        stylistAccountId: stylist.accountId,
        visits: p.visits ?? [],
      }));
    if (targets.length === 0) {
      continue;
    }
    const result = await seedVisits_IO({
      targets,
      galleryIdByAssetUrl: stylist.galleryIdByAssetUrl,
    });
    visitsCreated += result.visitsCreated;
  }
  if (visitsCreated > 0) {
    results.push(`Demo community visits created (${visitsCreated})`);
  }

  for (const pair of pairs) {
    if (pair.session) {
      await ensureSession_IO(pair, pair.session, now, results);
    }
  }

  await seedFavorites_IO(pairs, input);
};
