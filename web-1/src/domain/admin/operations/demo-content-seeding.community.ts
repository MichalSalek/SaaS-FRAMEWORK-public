import { DB_CLIENT } from '@app/db/db.client';
import { TIME } from '@kernel/application/constants.config';
import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import { isBrandAccentHex } from '@kernel/domain/user-and-account/branding.config';
import type { DemoPhoto } from './demo-content-seeding.photos';
import { DEMO_PHOTOS_ANIA } from './demo-content-seeding.photos';
import {
  DEMO_PHOTOS_OLA,
  DEMO_PHOTOS_NINA,
} from './demo-content-seeding.photos-guests';
import {
  DEMO_STYLIST_PROFILE,
  STYLIST_NINA_PROFILE,
  resolveDemoAssetUrl,
} from './demo-content-seeding.config';
import { ensureGuestStylist_IO } from './demo-content-seeding.stylists';
import { seedStylistGallery_IO } from './demo-content-seeding.gallery';
import {
  ensureNewClients_IO,
  type DemoClientAccounts,
} from './demo-content-seeding.clients';
import {
  DEMO_COMMUNITY_STYLISTS,
  DEMO_STAFF_PROFILES,
  type DemoStylistProfile,
} from './demo-content-seeding.community-stylists-data';
import { DEMO_COMMUNITY_CLIENTS } from './demo-content-seeding.community-data';
import { seedCommunityRelations_IO } from './demo-content-seeding.community-relations';
import { seedCommunityExtras_IO } from './demo-content-seeding.community-extras';

/**
 * Community layer of the demo showcase (2026-09-15), wired into
 * seedDemoContent_IO after the first showcase, because it uses those accounts
 * and galleries. Data: demo-content-seeding.community-*-data.ts. Re-runs use
 * find-or-create on stable keys (email, vanity, token, title) and createMany
 * with skipDuplicates for bulk rows.
 */

export interface DemoStylistAnchor {
  userId: string;
  accountId: string;
  photos: readonly DemoPhoto[];
  galleryIdByAssetUrl: Map<string, string>;
}

export interface DemoCommunityInput {
  now: Date;
  results: string[];
  colorByName: Map<string, string>;
  traitByName: Map<string, string>;
  /** Base stylists already seeded: ania / ola / nina (accounts and gallery maps). */
  baseStylists: Record<
    'ania' | 'ola' | 'nina',
    Omit<DemoStylistAnchor, 'photos'>
  >;
  /** Base clients already seeded: 'karolina' plus DEMO_NEW_CLIENTS slugs. */
  baseClients: Map<string, DemoClientAccounts>;
}

/** Empty profile fields only: hand edits on a demo account stay. */
const fillMissingProfile = async (
  accountId: string,
  profile: DemoStylistProfile
): Promise<void> => {
  const account = await DB_CLIENT.use.stylistAccount.findUnique({
    where: { account_id: accountId },
  });
  if (!account) {
    return;
  }
  const data: Partial<Record<keyof DemoStylistProfile, string>> = {};
  for (const [key, value] of Object.entries(profile) as [
    keyof DemoStylistProfile,
    string | undefined,
  ][]) {
    if (value !== undefined && account[key] === null) {
      data[key] = value;
    }
  }
  if (Object.keys(data).length > 0) {
    // vanity_url is @unique. A collision with someone else's account is bad
    // demo data and must throw, not pass quietly.
    await DB_CLIENT.use.stylistAccount.update({
      where: { account_id: accountId },
      data,
    });
  }
};

export const seedDemoCommunity_IO = async (
  input: DemoCommunityInput
): Promise<{ stylistAccountIds: string[] }> => {
  const { now, results, colorByName, traitByName } = input;
  const stylists = new Map<string, DemoStylistAnchor>([
    ['ania', { ...input.baseStylists.ania, photos: DEMO_PHOTOS_ANIA }],
    ['ola', { ...input.baseStylists.ola, photos: DEMO_PHOTOS_OLA }],
    ['nina', { ...input.baseStylists.nina, photos: DEMO_PHOTOS_NINA }],
  ]);

  // ── 1. Pięć nowych stylistek + ich galerie ────────────────────────────────
  for (const spec of DEMO_COMMUNITY_STYLISTS) {
    const { user, account } = await ensureGuestStylist_IO({
      userConfig: { email: spec.email, display_name: spec.displayName },
      profile: spec.profile,
      pricingPlan: spec.plan,
      paymentStatus: spec.paymentStatus,
      now,
      results,
    });
    const { galleryIdByAssetUrl, created } = await seedStylistGallery_IO({
      stylistAccountId: account.account_id,
      photos: spec.photos,
      pinnedAssetUrls: spec.photos
        .slice(0, spec.pinnedCount)
        .map(p => resolveDemoAssetUrl(p.asset_url)),
      colorByName,
      traitByName,
      now,
      ageOffsetDays: spec.galleryAgeOffsetDays,
    });
    if (created > 0) {
      results.push(`Demo gallery (${spec.displayName}): ${created} created`);
    }
    stylists.set(spec.slug, {
      userId: user.id,
      accountId: account.account_id,
      photos: spec.photos,
      galleryIdByAssetUrl,
    });
  }

  const communityAccountIds = DEMO_COMMUNITY_STYLISTS.flatMap(spec => {
    const anchor = stylists.get(spec.slug);
    return anchor ? [anchor.accountId] : [];
  });
  // @example.com accounts must stay out of mail sweeps (trial, marketing), and
  // a plan set by the seed must survive the Stripe sync at login.
  await DB_CLIENT.use.stylistAccount.updateMany({
    where: {
      account_id: { in: communityAccountIds },
      OR: [
        { email_marketing: true },
        { email_trial_sequence: true },
        { admin_plan_override: false },
      ],
    },
    data: {
      email_marketing: false,
      email_trial_sequence: false,
      admin_plan_override: true,
    },
  });

  // Trial window refreshed on every run: the countdown banner (7 days or fewer)
  // stays visible no matter when the seed last ran.
  const trialAccountIds = DEMO_COMMUNITY_STYLISTS.filter(s => s.trial).flatMap(
    spec => {
      const anchor = stylists.get(spec.slug);
      return anchor ? [anchor.accountId] : [];
    }
  );
  if (trialAccountIds.length > 0) {
    await DB_CLIENT.use.stylistAccount.updateMany({
      where: { account_id: { in: trialAccountIds } },
      data: {
        subscription_status: SubscriptionStatusValue.TRIALING,
        trial_started_at: new Date(now.getTime() - 25 * TIME.MS_PER_DAY),
        trial_ends_at: new Date(now.getTime() + 5 * TIME.MS_PER_DAY),
        trial_reminder_sent: false,
      },
    });
  }

  // ── 2. Personel salonu Ani: wizytówki i kilka prac ────────────────────────
  const staffAccountIds: string[] = [];
  for (const staff of DEMO_STAFF_PROFILES) {
    const account = await DB_CLIENT.use.stylistAccount.findFirst({
      where: { created_by_user: { email: staff.email } },
      select: { account_id: true },
    });
    if (!account) {
      continue;
    }
    staffAccountIds.push(account.account_id);
    await fillMissingProfile(account.account_id, staff.profile);
    await seedStylistGallery_IO({
      stylistAccountId: account.account_id,
      photos: staff.photos,
      pinnedAssetUrls: staff.photos
        .slice(0, staff.pinnedCount)
        .map(p => resolveDemoAssetUrl(p.asset_url)),
      colorByName,
      traitByName,
      now,
      ageOffsetDays: staff.galleryAgeOffsetDays,
    });
  }

  // ── 3. Kolor akcentu spoza palety (wartości sprzed walidatora) → paleta ───
  await healBrandAccents_IO([...stylists.values()].map(s => s.accountId));

  // ── 4. Dwie nowe klientki ─────────────────────────────────────────────────
  const communityClients = await ensureNewClients_IO({
    results,
    specs: DEMO_COMMUNITY_CLIENTS,
  });
  for (const spec of DEMO_COMMUNITY_CLIENTS) {
    const client = communityClients.get(spec.slug);
    if (client) {
      await DB_CLIENT.use.clientAccount.updateMany({
        where: {
          client_account_id: client.clientAccountId,
          contact_phone: null,
        },
        data: { contact_phone: spec.contactPhone },
      });
    }
  }
  const clients = new Map([...input.baseClients, ...communityClients]);

  // ── 5. Relacje (pary, QR, wiadomości, wizyty, sesje, lajki) i zaplecze ────
  await seedCommunityRelations_IO({ now, results, stylists, clients });
  await seedCommunityExtras_IO({ now, results, stylists });

  return {
    stylistAccountIds: [
      ...new Set([
        ...[...stylists.values()].map(s => s.accountId),
        ...staffAccountIds,
      ]),
    ],
  };
};

/**
 * Showcase accounts were given accent colours outside the curated palette
 * (#9e2b25, #5b4a8a). The account picker cannot select them and the validator
 * would reject them. Use the profile config value when it is in the palette,
 * otherwise null (the profile returns to the default tone).
 */
const healBrandAccents_IO = async (accountIds: string[]): Promise<void> => {
  const rows = await DB_CLIENT.use.stylistAccount.findMany({
    where: {
      account_id: { in: accountIds },
      brand_accent_color: { not: null },
    },
    select: { account_id: true, brand_accent_color: true, vanity_url: true },
  });
  const configured = new Map<string, string>([
    [DEMO_STYLIST_PROFILE.vanity_url, DEMO_STYLIST_PROFILE.brand_accent_color],
    [STYLIST_NINA_PROFILE.vanity_url, STYLIST_NINA_PROFILE.brand_accent_color],
  ]);
  for (const row of rows) {
    if (row.brand_accent_color && isBrandAccentHex(row.brand_accent_color)) {
      continue;
    }
    const fallback = row.vanity_url ? configured.get(row.vanity_url) : null;
    await DB_CLIENT.use.stylistAccount.update({
      where: { account_id: row.account_id },
      data: {
        brand_accent_color:
          fallback && isBrandAccentHex(fallback) ? fallback : null,
      },
    });
  }
};
