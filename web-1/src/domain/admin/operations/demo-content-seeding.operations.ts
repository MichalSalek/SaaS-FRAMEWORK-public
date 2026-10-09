import { DB_CLIENT } from '@app/db/db.client';
import { ENV_VARS } from '@app/environment/environment.config';
import {
  PairingStatusValue,
  SupportThreadStatusValue,
  SupportSenderTypeValue,
} from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { TEST_USERS_CONFIG } from '@kernel/config/test-users.config';
import { TIME } from '@kernel/application/constants.config';
import { ensureDemoAccounts_IO } from './demo-content-seeding.accounts';
import {
  ensureGuestStylist_IO,
  ensureSalonStaff_IO,
} from './demo-content-seeding.stylists';
import { seedStylistGallery_IO } from './demo-content-seeding.gallery';
import {
  ensureNewClients_IO,
  ensureNewClientPairs_IO,
} from './demo-content-seeding.clients';
import {
  ensureAniaSessions_IO,
  ensureOlaSharedSession_IO,
  ensureNewClientSharedSessions_IO,
} from './demo-content-seeding.sessions';
import {
  seedKarolinaFavorites_IO,
  seedNewClientLikes_IO,
} from './demo-content-seeding.favorites';
import { seedVisits_IO } from './demo-content-seeding.visits';
import {
  buildDemoVisitTargets,
  buildDemoMessageTargets,
} from './demo-content-seeding.targets';
import { resolveDemoSeedGate } from './demo-content-seeding.guard';
import { seedDemoCommunity_IO } from './demo-content-seeding.community';
import { recomputeDemoCachedCounts_IO } from './demo-content-seeding.counts';
import { purgeRemovedDemoAssets_IO } from './demo-content-seeding.cleanup';
import { seedMessageThreads_IO } from './demo-content-seeding.messages';
import {
  DEMO_SUPPORT_THREAD,
  DEMO_GALLERY,
  DEMO_PINNED_ANIA_EXTRA,
  DEMO_PINNED_OLA,
  DEMO_PINNED_NINA,
  STYLIST_OLA_PROFILE,
  STYLIST_NINA_PROFILE,
} from './demo-content-seeding.config';
import { DEMO_PHOTOS_ANIA } from './demo-content-seeding.photos';
import {
  DEMO_PHOTOS_OLA,
  DEMO_PHOTOS_NINA,
} from './demo-content-seeding.photos-guests';

/**
 * Demo content seed — trwala "wystawa" do recznego klikania po apce i QA wizualnego.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Konta DEMO (demo-stylist-main / demo-client-main) sa ODSEPAROWANE od smoke-trio:
 * smoke testy przy kazdym runie kasuja cala galerie test-stylistki i revokuja jej pary
 * (tests/smoke/_setup.ts pre-clean), wiec content na smoke-kontach nie przezywa restartu.
 * Demo-duo zyje obok — smoke testy go NIE znaja i NIE dotykaja. Seed jest idempotentny
 * i self-healing: galeria/para/ulubione = find-or-create, sesja SHARED dostaje przy
 * kazdym seedzie swiezy shared_at/expires_at (+7 dni), wiec wizualnie nigdy nie wygasa.
 *
 * Gate: WYLACZNIE NODE_ENV_MANUAL=DEVELOPMENT — celowo CIASNIEJ niz seedTestUsers_IO
 * (ktory dziala tez przy RUN_SMOKE_TESTS_ON_STARTUP=true, czyli na preview/prod).
 * Demo-stylistka ma account_status ACTIVE => publicznie widoczny profil z galeria;
 * na preview/produkcji takiej wystawy byc nie moze.
 *
 * S111 (2026-09-14): wystawa rozszerzona o dwie stylistki-gościa (Ola, Nina — feed
 * "Odkrywaj" i lista publicznych profili), personel salonu Ani (Marta, Kasia) i 7
 * nowych klientek z wizytami/wiadomościami/sesjami, żeby ~40 różnych ekranów miało
 * czym się wypełnić. Logika podzielona na demo-content-seeding.{gallery,stylists,
 * clients,clients-data,sessions,favorites,visits,messages}.ts — dane w .config.ts
 * i .clients-data.ts, orkiestracja tutaj.
 *
 * 2026-09-15: warstwa „społeczności" (demo-content-seeding.community*.ts) dokłada
 * 5 stylistek na planach Free/Pro (trial)/Pro Marka/Scale, 2 klientki, pary
 * PENDING/REVOKED i przez QR, sesje READY/EXPIRED/CLOSED, support w każdym
 * statusie, zgłoszenia, komunikaty i newsletter. Seed można też odpalić na
 * STAGINGU, ale wyłącznie ręcznie z CLI (trigger 'CLI'); boot dalej rusza go
 * tylko na DEVELOPMENT. Obie blokady produkcji: demo-content-seeding.guard.ts.
 */
/**
 * DECISION (nie usuwaj tego komentarza) — BLAD DANYCH JEST GLOSNY NA CLI,
 * A NIGDY SMIERTELNY NA BOOCIE:
 * wnetrze seeda RZUCA przy zlamanym niezmienniku danych (nazwa pliku spoza banku,
 * kolor albo cecha spoza slownika, slug klientki bez konta) — literowka ma
 * wybuchnac, a nie po cichu zostawic wpol zbudowana wystawe przy zielonym
 * komunikacie. Ale blok seedowania w `instrumentation.ts` NIE MA wlasnego
 * try/catch, wiec ten sam wyjatek na starcie polozylby backend deweloperski.
 * Ta sama zasada, ktora `resolveDemoSeedGate` stosuje do ODMOWY BRAMKI, obowiazuje
 * wiec dla KAZDEJ awarii seeda: BOOT zamienia ja w raportowane pominiecie, CLI
 * przepuszcza dalej. Roznica jest celowa — na CLI seed jest zadaniem samym w sobie
 * i jego porazka musi byc widoczna kodem wyjscia; na boocie jest dodatkiem do
 * uruchomienia aplikacji i nie ma prawa go zablokowac.
 */
export const seedDemoContent_IO = async (
  args: {
    trigger?: 'BOOT' | 'CLI';
  } = {}
): Promise<{ success: boolean; message: string }> => {
  const trigger = args.trigger ?? 'BOOT';
  try {
    return await runDemoContentSeed(trigger);
  } catch (error) {
    if (trigger === 'CLI') {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Demo seed failed: ${reason}` };
  }
};

const runDemoContentSeed = async (
  trigger: 'BOOT' | 'CLI'
): Promise<{
  success: boolean;
  message: string;
}> => {
  // Boot: tylko DEVELOPMENT, odmowa bramki = pominięcie (start backendu nie
  // może paść). CLI: odmowa rzuca. Logika i DECISION: demo-content-seeding.guard.ts.
  const gate = resolveDemoSeedGate({
    trigger,
    nodeEnvManual: ENV_VARS.NODE_ENV_MANUAL,
    databaseUrl: ENV_VARS.DATABASE_URL,
  });
  if (!gate.run) {
    return { success: true, message: `Skipped (${gate.reason})` };
  }

  const results: string[] = [];
  const now = new Date();

  // ── 0. Pliki wycofane przez ownera (DECISION: demo-content-seeding.cleanup) ─
  await purgeRemovedDemoAssets_IO(results);

  // ── 1. Konta demo-duo (Ania + Karolina) ───────────────────────────────────
  const {
    stylistUser: aniaUser,
    stylistAccount: aniaAccount,
    clientUser: karolina,
    clientAccount: karolinaAccount,
  } = await ensureDemoAccounts_IO(results);

  // ── 2. Kolory/cechy (lookup jednorazowy, dzielony przez wszystkie galerie) ─
  const colorByName = new Map(
    (await DB_CLIENT.use.color.findMany({ take: 200 })).map(c => [c.name, c.id])
  );
  const traitByName = new Map(
    (await DB_CLIENT.use.trait.findMany({ take: 200 })).map(t => [t.name, t.id])
  );

  // ── 3. Galeria Ani (41 zdjęć, DEMO_PHOTOS_ANIA nadzbiór oryginalnej dziesiątki) ─
  const aniaPinned = [
    ...DEMO_GALLERY.filter(e => e.is_pinned).map(e => e.asset_url),
    ...DEMO_PINNED_ANIA_EXTRA,
  ];
  const {
    galleryIdByAssetUrl: aniaGalleryIdByUrl,
    created: aniaGalleryCreated,
  } = await seedStylistGallery_IO({
    stylistAccountId: aniaAccount.account_id,
    photos: DEMO_PHOTOS_ANIA,
    pinnedAssetUrls: aniaPinned,
    colorByName,
    traitByName,
    now,
  });
  if (aniaGalleryCreated > 0) {
    results.push(`Demo gallery (Ania): ${aniaGalleryCreated} records created`);
  }

  // ── 4. Stylistki-goście (Ola, Nina) + ich galerie ─────────────────────────
  const { user: olaUser, account: olaAccount } = await ensureGuestStylist_IO({
    userConfig: TEST_USERS_CONFIG.DEMO_STYLIST_OLA,
    profile: STYLIST_OLA_PROFILE,
    pricingPlan: PricingPlanValue.PRO,
    now,
    results,
  });
  const { user: ninaUser, account: ninaAccount } = await ensureGuestStylist_IO({
    userConfig: TEST_USERS_CONFIG.DEMO_STYLIST_NINA,
    profile: STYLIST_NINA_PROFILE,
    pricingPlan: PricingPlanValue.PRO_PLUS,
    now,
    results,
  });

  const { galleryIdByAssetUrl: olaGalleryIdByUrl, created: olaGalleryCreated } =
    await seedStylistGallery_IO({
      stylistAccountId: olaAccount.account_id,
      photos: DEMO_PHOTOS_OLA,
      pinnedAssetUrls: DEMO_PINNED_OLA,
      colorByName,
      traitByName,
      now,
    });
  if (olaGalleryCreated > 0) {
    results.push(`Demo gallery (Ola): ${olaGalleryCreated} records created`);
  }
  const {
    galleryIdByAssetUrl: ninaGalleryIdByUrl,
    created: ninaGalleryCreated,
  } = await seedStylistGallery_IO({
    stylistAccountId: ninaAccount.account_id,
    photos: DEMO_PHOTOS_NINA,
    pinnedAssetUrls: DEMO_PINNED_NINA,
    colorByName,
    traitByName,
    now,
  });
  if (ninaGalleryCreated > 0) {
    results.push(`Demo gallery (Nina): ${ninaGalleryCreated} records created`);
  }

  // ── 5. Personel salonu Ani (Marta, Kasia — StaffMember EMPLOYEE) ──────────
  await ensureSalonStaff_IO({
    ownerAccountId: aniaAccount.account_id,
    now,
    results,
  });

  // ── 6. Pary Karoliny (Ania — istniejąca, Ola — nowa) ──────────────────────
  await DB_CLIENT.use.clientStylistPair.upsert({
    where: {
      client_user_id_stylist_account_id: {
        client_user_id: karolina.id,
        stylist_account_id: aniaAccount.account_id,
      },
    },
    create: {
      client_user_id: karolina.id,
      stylist_account_id: aniaAccount.account_id,
      status: PairingStatusValue.ACTIVE,
    },
    update: { status: PairingStatusValue.ACTIVE, revoked_at: null },
  });
  await DB_CLIENT.use.clientStylistPair.upsert({
    where: {
      client_user_id_stylist_account_id: {
        client_user_id: karolina.id,
        stylist_account_id: olaAccount.account_id,
      },
    },
    create: {
      client_user_id: karolina.id,
      stylist_account_id: olaAccount.account_id,
      status: PairingStatusValue.ACTIVE,
    },
    update: { status: PairingStatusValue.ACTIVE, revoked_at: null },
  });

  // ── 7. 7 nowych klientek Ani (konta + pary + notatki CRM) ─────────────────
  const clientsBySlug = await ensureNewClients_IO({ results });
  await ensureNewClientPairs_IO({
    stylistAccountId: aniaAccount.account_id,
    clientsBySlug,
    now,
  });

  // ── 8. Sesje ────────────────────────────────────────────────────────────
  await ensureAniaSessions_IO({
    stylistAccountId: aniaAccount.account_id,
    clientAccountId: karolinaAccount.client_account_id,
    galleryIdByAssetUrl: aniaGalleryIdByUrl,
    now,
    results,
  });
  await ensureOlaSharedSession_IO({
    stylistAccountId: olaAccount.account_id,
    clientAccountId: karolinaAccount.client_account_id,
    galleryIdByAssetUrl: olaGalleryIdByUrl,
    now,
    results,
  });
  await ensureNewClientSharedSessions_IO({
    stylistAccountId: aniaAccount.account_id,
    clientsBySlug,
    galleryIdByAssetUrl: aniaGalleryIdByUrl,
    now,
    results,
  });

  // ── 9. Ulubione (bookmarki + lajki) ────────────────────────────────────────
  await seedKarolinaFavorites_IO({
    clientUserId: karolina.id,
    stylistAccountIds: {
      ania: aniaAccount.account_id,
      ola: olaAccount.account_id,
      nina: ninaAccount.account_id,
    },
    galleryMaps: {
      ania: aniaGalleryIdByUrl,
      ola: olaGalleryIdByUrl,
      nina: ninaGalleryIdByUrl,
    },
    results,
  });
  await seedNewClientLikes_IO({
    clientsBySlug,
    aniaGalleryIdByUrl,
    results,
  });

  // ── 10. Wizyty (Karolina + 7 nowych klientek, wszystkie u Ani) ────────────
  const { visitsCreated } = await seedVisits_IO({
    targets: buildDemoVisitTargets({
      karolinaUserId: karolina.id,
      aniaAccountId: aniaAccount.account_id,
      clientsBySlug,
    }),
    galleryIdByAssetUrl: aniaGalleryIdByUrl,
  });
  if (visitsCreated > 0) {
    results.push(`Demo visits created (${visitsCreated})`);
  }

  // ── 11. Wiadomości (Karolina×2 + 7 nowych klientek z Anią) ────────────────
  await seedMessageThreads_IO({
    targets: buildDemoMessageTargets({
      karolinaUserId: karolina.id,
      aniaAccountId: aniaAccount.account_id,
      olaAccountId: olaAccount.account_id,
      clientsBySlug,
    }),
    now,
    results,
  });

  // ── 12. Watek supportu klientki (lista + detail z dialogiem) ──────────────
  const supportThread = await DB_CLIENT.use.supportThread.findFirst({
    where: { user_id: karolina.id, subject: DEMO_SUPPORT_THREAD.subject },
  });
  if (!supportThread) {
    await DB_CLIENT.use.supportThread.create({
      data: {
        user_id: karolina.id,
        subject: DEMO_SUPPORT_THREAD.subject,
        status: SupportThreadStatusValue.OPEN,
        messages: {
          // Rozsuniete created_at: createMany w jednej transakcji dawal
          // identyczny timestamp i odpowiedz renderowala sie NAD pytaniem.
          create: [
            {
              sender_type: SupportSenderTypeValue.USER,
              content: DEMO_SUPPORT_THREAD.user_message,
              created_at: new Date(now.getTime() - 2 * TIME.MS_PER_HOUR),
            },
            {
              sender_type: SupportSenderTypeValue.SUPPORT,
              content: DEMO_SUPPORT_THREAD.support_reply,
              created_at: new Date(now.getTime() - TIME.MS_PER_HOUR),
            },
          ],
        },
      },
    });
    results.push('Demo support thread created');
  }

  // ── 12.5. Warstwa społeczności (stylistki, klientki, relacje, zaplecze) ───
  const { stylistAccountIds: communityStylistAccountIds } =
    await seedDemoCommunity_IO({
      now,
      results,
      colorByName,
      traitByName,
      baseStylists: {
        ania: {
          userId: aniaUser.id,
          accountId: aniaAccount.account_id,
          galleryIdByAssetUrl: aniaGalleryIdByUrl,
        },
        ola: {
          userId: olaUser.id,
          accountId: olaAccount.account_id,
          galleryIdByAssetUrl: olaGalleryIdByUrl,
        },
        nina: {
          userId: ninaUser.id,
          accountId: ninaAccount.account_id,
          galleryIdByAssetUrl: ninaGalleryIdByUrl,
        },
      },
      baseClients: new Map([
        [
          'karolina',
          {
            userId: karolina.id,
            clientAccountId: karolinaAccount.client_account_id,
          },
        ],
        ...clientsBySlug,
      ]),
    });

  // ── 13. Cached counts (denormalizowane liczniki) — wszystkie stylistki demo ─
  await recomputeDemoCachedCounts_IO([
    aniaAccount.account_id,
    olaAccount.account_id,
    ninaAccount.account_id,
    ...communityStylistAccountIds,
  ]);

  if (results.length === 0) {
    results.push('Demo content up to date');
  }

  return { success: true, message: results.join(', ') };
};
