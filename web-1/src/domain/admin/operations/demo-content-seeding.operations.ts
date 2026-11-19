import { DB_CLIENT } from '@app/db/db.client';
import { ENV_VARS } from '@app/environment/environment.config';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
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
import {
  DEMO_KAROLINA_ANIA_CRM_NOTE,
  DEMO_KAROLINA_ANIA_CRM_NOTE_CLOCK_UTC,
  DEMO_KAROLINA_ANIA_CRM_NOTE_UPDATED_DAYS_AGO,
} from './demo-content-seeding.karolina-data';
import { resolveDemoTime } from './demo-content-seeding.clients-data';
import { ensureDemoSupportThread_IO } from './demo-content-seeding.support-migration';

/**
 * Demo showcase seed. Pieces live in demo-content-seeding.*.ts; this file orchestrates.
 * DECISION: demo accounts stay off the smoke-test users, whose pre-clean wipes gallery
 * and pairs. Re-runs use find-or-create; SHARED sessions refresh shared_at and expires_at
 * every run. Boot is DEVELOPMENT only, the CLI also STAGING (demo-content-seeding.guard.ts).
 * A broken data invariant throws. Boot has no try/catch in instrumentation.ts, so that
 * throw becomes a reported skip; the CLI keeps it as the exit code.
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
  // Boot: DEVELOPMENT only. A gate refusal is a skip (backend startup must
  // stay up). CLI: a refusal throws. Logic and DECISION: demo-content-seeding.guard.ts.
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
  const karolinaNoteUpdatedAt = resolveDemoTime(
    now,
    (DEMO_KAROLINA_ANIA_CRM_NOTE_UPDATED_DAYS_AGO * TIME.MS_PER_DAY) /
      TIME.MS_PER_HOUR,
    DEMO_KAROLINA_ANIA_CRM_NOTE_CLOCK_UTC
  );
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
      crm_note: DEMO_KAROLINA_ANIA_CRM_NOTE,
      crm_note_updated_at: karolinaNoteUpdatedAt,
    },
    // Note on the main demo client: her card is on public-page screenshots
    // and used to sit there with an empty note. (owner)
    update: {
      status: PairingStatusValue.ACTIVE,
      revoked_at: null,
      crm_note: DEMO_KAROLINA_ANIA_CRM_NOTE,
      crm_note_updated_at: karolinaNoteUpdatedAt,
    },
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
  await ensureDemoSupportThread_IO({ userId: karolina.id, now, results });

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
