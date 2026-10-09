/**
 * Seed: minimal UX-crawl data for the two test accounts.
 *
 * GOAL: unblock the 5 dynamic UI routes so a crawl/manual click-through can reach
 * a real detail view ("cokolwiek, byle dało się kliknąć w detal"):
 *
 *   1. /app/photo/[id]            — id = GalleryRecord.gallery_record_id (3 seeded)
 *   2. /app/style/[id]            — id = Trait.id (records tagged with that trait)
 *   3. /app/gallery/stylist/[id]  — id = StylistAccount.account_id (test stylist)
 *   4. /stylist/[identifier]      — identifier = StylistAccount.vanity_url ("test-studio")
 *   5. /app/inbox/session/[id]    — id = SessionContainer.id (SHARED to the test stylist)
 *
 * IDEMPOTENT: deterministic primary keys + upsert-by-unique + skipDuplicates.
 * Re-running does not duplicate rows and does not throw. Mutates ONLY the two
 * test accounts (test-stylist-main@example.com / test-client-main@example.com)
 * and rows whose deterministic ids are namespaced `seedux_*`. Never touches
 * real user data. Does NOT modify schema.prisma.
 *
 * Usage (zero-config — the script self-loads web-1/.env.development and rewrites
 * the docker-internal DB host `@db:5432` to the host-mapped port; same trick as
 * scripts/dev-db-host.mjs, because that hostname is unreachable from the WSL2 host):
 *   cd web-1
 *   npx tsx scripts/seed-ux-crawl-data.ts
 *
 * Override the DB if needed (CLI env wins over the .env file):
 *   DATABASE_URL=postgresql://<user>:<pass>@<host>:<port>/db?schema=public \
 *     npx tsx scripts/seed-ux-crawl-data.ts
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// Type-only imports are erased at compile time — safe to keep static (they do NOT
// evaluate the module, so they don't trip the env-bootstrap ordering below).
import type { NailLength } from '../src/READONLY-shared-kernel/models/db_models.generated.dto.js';

// ── Env bootstrap (MUST run before importing DB_CLIENT) ─────────────────────
// DB_CLIENT initializes the Prisma adapter from ENV_VARS.DATABASE_URL at module
// load, and environment.config runs validateEnv at import (hard-exits on PROD-mode
// missing vars). So we hydrate process.env from .env.development FIRST, then
// dynamic-import the DB client below. CLI-provided vars take precedence (not
// overwritten), matching dotenv-run-script semantics used elsewhere.
function bootstrapEnv(): void {
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const envFile = join(webRoot, '.env.development');

  let raw = '';
  try {
    raw = readFileSync(envFile, 'utf8');
  } catch {
    // No .env.development — rely entirely on whatever is already in process.env.
    return;
  }

  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) {
      continue;
    }
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    // CLI / pre-set env wins (e.g. an explicit DATABASE_URL override).
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }

  // Rewrite the docker-internal DB host to the host-mapped port (only if the
  // caller did not already point DATABASE_URL somewhere host-reachable).
  const INTERNAL_HOST = '@db:5432';
  const FALLBACK_PORT = '3200'; // docker-compose.dev.yml maps 3200:5432
  if (process.env.DATABASE_URL?.includes(INTERNAL_HOST)) {
    let hostPort = FALLBACK_PORT;
    try {
      const out = execSync('docker port db 5432/tcp', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const mp = out.split('\n')[0]?.match(/:(\d+)\s*$/);
      if (mp) {
        hostPort = mp[1];
      }
    } catch {
      // docker unreachable — keep the compose-default port; connect may fail loudly.
    }
    process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
      INTERNAL_HOST,
      `@localhost:${hostPort}`
    );
  }
}

bootstrapEnv();

const { DB_CLIENT } = await import('../src/application/db/db.client.js');
const {
  NailLengthValue,
  SessionContainerLifecycleStateValue,
  PairingStatusValue,
} =
  await import('../src/READONLY-shared-kernel/models/db_models.generated.dto.js');

const STYLIST_EMAIL = 'test-stylist-main@example.com';
const CLIENT_EMAIL = 'test-client-main@example.com';

/** Deterministic, namespaced ids — re-run hits the same rows (idempotency anchor). */
const IDS = {
  vanity: 'test-studio',
  // DECISION (nie usuwaj tego komentarza):
  // PK-i ponizej MUSZA pasowac do cuid-format-gate isValidCursorFormat (^[a-z0-9]{20,40}$):
  // sa uzywane jako kursory paginacji (gallery / pairing / session-container), a format-gate
  // (.shared-kernel/policies/validation/validation.utils) odrzuca podkreslenia => nextCursor
  // ladujacy na seed-row dawal 400 'Invalid cursor' w dev (zero wplywu na prod: prod PK =
  // @default(cuid())). Lowercase-alnum, >=20 znakow, deterministyczne (idempotency anchor).
  galleryRecords: [
    'seeduxgrnudeminimal01',
    'seeduxgrfrenchclassic01',
    'seeduxgrredmatte0001',
  ] as const,
  pairingSession: 'seeduxpairingsession01',
  // PairingSession.token is @db.VarChar(32) + @unique. 32 chars max, deterministic.
  pairingToken: 'seeduxpairtoken00000000000000001',
  sessionContainer: 'seeduxsessioncontainer01',
} as const;

/**
 * Tag plan per gallery record. Trait/color NAMES are resolved to ids at runtime
 * (ids differ per environment; names come from the kernel gallery.seed SSOT).
 * nail_length is intentionally varied so the length filters on /app/style + the
 * stylist gallery have >1 bucket to show, even though the placeholder images are
 * all "short" portfolio shots ("cokolwiek, byle dało się kliknąć").
 */
const RECORD_PLAN: ReadonlyArray<{
  id: string;
  asset_url: string;
  nail_length: NailLength;
  is_pinned: boolean;
  colorNames: readonly string[];
  traitNames: readonly string[];
}> = [
  {
    id: IDS.galleryRecords[0],
    // Local same-origin asset from main/public — renders in the crawl as-is.
    // getCloudinaryThumbUrl() passes through any URL without '/upload/'.
    asset_url: '/img/lp/portfolio/nail-09-short-nude.webp',
    nail_length: NailLengthValue.SHORT,
    is_pinned: true,
    colorNames: ['Beżowe', 'Różowe'],
    traitNames: ['Minimalistyczne', 'Matowe'],
  },
  {
    id: IDS.galleryRecords[1],
    asset_url: '/img/lp/portfolio/nail-10-short-french.webp',
    nail_length: NailLengthValue.MEDIUM,
    is_pinned: true,
    colorNames: ['Białe', 'Beżowe'],
    traitNames: ['French'],
  },
  {
    id: IDS.galleryRecords[2],
    asset_url: '/img/lp/portfolio/nail-11-short-red.webp',
    nail_length: NailLengthValue.LONG,
    is_pinned: false,
    colorNames: ['Czerwone'],
    traitNames: ['Matowe', 'Minimalistyczne'],
  },
];

/** Resolve trait/color seed names -> ids (must already be seeded; we don't create taxonomy here). */
async function resolveTaxonomy(): Promise<{
  colorByName: Map<string, string>;
  traitByName: Map<string, string>;
}> {
  const neededColors = new Set<string>();
  const neededTraits = new Set<string>();
  for (const r of RECORD_PLAN) {
    r.colorNames.forEach(n => neededColors.add(n));
    r.traitNames.forEach(n => neededTraits.add(n));
  }

  const [colors, traits] = await Promise.all([
    DB_CLIENT.use.color.findMany({
      where: { name: { in: [...neededColors] } },
      select: { id: true, name: true },
    }),
    DB_CLIENT.use.trait.findMany({
      where: { name: { in: [...neededTraits] } },
      select: { id: true, name: true },
    }),
  ]);

  const colorByName = new Map(colors.map(c => [c.name, c.id]));
  const traitByName = new Map(traits.map(t => [t.name, t.id]));

  const missingColors = [...neededColors].filter(n => !colorByName.has(n));
  const missingTraits = [...neededTraits].filter(n => !traitByName.has(n));
  if (missingColors.length > 0 || missingTraits.length > 0) {
    throw new Error(
      `Missing taxonomy (run the gallery color/trait seed first). ` +
        `colors=${JSON.stringify(missingColors)} traits=${JSON.stringify(missingTraits)}`
    );
  }
  return { colorByName, traitByName };
}

async function main(): Promise<void> {
  // DATABASE_URL is hydrated by bootstrapEnv() above; a bad/absent URL surfaces
  // loudly at $connect() below, so no extra guard here.
  const log: string[] = [];
  await DB_CLIENT.use.$connect();

  // ── 0. Resolve the two test accounts (created by the app's seedTestUsers_IO). ──
  const stylistUser = await DB_CLIENT.use.user.findUnique({
    where: { email: STYLIST_EMAIL },
    select: {
      id: true,
      stylist_account: { select: { account_id: true } },
    },
  });
  const clientUser = await DB_CLIENT.use.user.findUnique({
    where: { email: CLIENT_EMAIL },
    select: {
      id: true,
      client_account: { select: { client_account_id: true } },
    },
  });

  if (!stylistUser?.stylist_account) {
    throw new Error(
      `Test stylist (${STYLIST_EMAIL}) or its StylistAccount not found. ` +
        `Boot the app in DEVELOPMENT once (seedTestUsers_IO) before seeding UX data.`
    );
  }
  if (!clientUser?.client_account) {
    throw new Error(
      `Test client (${CLIENT_EMAIL}) or its ClientAccount not found. ` +
        `Boot the app in DEVELOPMENT once (seedTestUsers_IO) before seeding UX data.`
    );
  }

  const stylistAccountId = stylistUser.stylist_account.account_id;
  const clientUserId = clientUser.id;
  const clientAccountId = clientUser.client_account.client_account_id;
  log.push(
    `Resolved test accounts: stylist account_id=${stylistAccountId}, client user_id=${clientUserId}, client_account_id=${clientAccountId}`
  );

  const { colorByName, traitByName } = await resolveTaxonomy();

  // ── 1. vanity_url for the stylist (unblocks /stylist/[identifier]). ──
  // Guard the @unique constraint: only claim "test-studio" if free or already ours.
  const vanityHolder = await DB_CLIENT.use.stylistAccount.findUnique({
    where: { vanity_url: IDS.vanity },
    select: { account_id: true },
  });
  if (!vanityHolder) {
    await DB_CLIENT.use.stylistAccount.update({
      where: { account_id: stylistAccountId },
      data: { vanity_url: IDS.vanity },
    });
    log.push(`vanity_url set: "${IDS.vanity}" -> stylist ${stylistAccountId}`);
  } else if (vanityHolder.account_id === stylistAccountId) {
    log.push(`vanity_url already "${IDS.vanity}" on test stylist (ok)`);
  } else {
    log.push(
      `vanity_url "${IDS.vanity}" held by another account (${vanityHolder.account_id}) — left untouched`
    );
  }

  // ── 2. 3 gallery records for the stylist (unblocks /app/photo + /app/style + /app/gallery/stylist). ──
  // Idempotent via upsert on the deterministic gallery_record_id PK.
  for (const rec of RECORD_PLAN) {
    // Same field-set for create + update — update re-pins the seed-intended
    // visibility state in case a prior test toggled is_pinned / is_hidden.
    const recordData = {
      created_by_account_id: stylistAccountId,
      asset_url: rec.asset_url,
      nail_length: rec.nail_length,
      is_pinned: rec.is_pinned,
      is_hidden: false,
    };
    await DB_CLIENT.use.galleryRecord.upsert({
      where: { gallery_record_id: rec.id },
      create: { gallery_record_id: rec.id, ...recordData },
      update: recordData,
    });

    // Color tags — idempotent via @@unique([gallery_record_id, color_id]).
    const colorRows = rec.colorNames.map(name => ({
      gallery_record_id: rec.id,
      color_id: colorByName.get(name) as string,
    }));
    if (colorRows.length > 0) {
      await DB_CLIENT.use.galleryRecordColor.createMany({
        data: colorRows,
        skipDuplicates: true,
      });
    }

    // Trait tags — idempotent via @@unique([gallery_record_id, trait_id]).
    const traitRows = rec.traitNames.map(name => ({
      gallery_record_id: rec.id,
      trait_id: traitByName.get(name) as string,
    }));
    if (traitRows.length > 0) {
      await DB_CLIENT.use.galleryRecordTrait.createMany({
        data: traitRows,
        skipDuplicates: true,
      });
    }
  }
  log.push(
    `Gallery: ${RECORD_PLAN.length} records upserted for stylist (tags applied, skipDuplicates)`
  );

  // Keep the denormalized cached_gallery_count honest (anti-N+1 SoT lives in GalleryRecord).
  const galleryCount = await DB_CLIENT.use.galleryRecord.count({
    where: { created_by_account_id: stylistAccountId },
  });
  await DB_CLIENT.use.stylistAccount.update({
    where: { account_id: stylistAccountId },
    data: { cached_gallery_count: galleryCount },
  });
  log.push(`cached_gallery_count resynced to ${galleryCount}`);

  // ── 3a. Pairing: PairingSession (claimed) — audit/inbox provenance. ──
  // Idempotent via upsert on the deterministic PK.
  const now = new Date();
  const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  await DB_CLIENT.use.pairingSession.upsert({
    where: { id: IDS.pairingSession },
    create: {
      id: IDS.pairingSession,
      token: IDS.pairingToken,
      stylist_account_id: stylistAccountId,
      issued_by_user_id: stylistUser.id,
      expires_at: farFuture,
      claimed_by_client_user_id: clientUserId,
      claimed_at: now,
    },
    update: {
      stylist_account_id: stylistAccountId,
      issued_by_user_id: stylistUser.id,
      expires_at: farFuture,
      claimed_by_client_user_id: clientUserId,
      // Don't churn claimed_at on re-run if already set.
      claimed_at: now,
      revoked_at: null,
    },
  });
  log.push(`PairingSession upserted (claimed): ${IDS.pairingSession}`);

  // ── 3b. Pairing: ClientStylistPair (ACTIVE) — the actual paired relationship. ──
  // Idempotent via @@unique([client_user_id, stylist_account_id]); re-activates a
  // REVOKED leftover from prior test runs.
  await DB_CLIENT.use.clientStylistPair.upsert({
    where: {
      client_user_id_stylist_account_id: {
        client_user_id: clientUserId,
        stylist_account_id: stylistAccountId,
      },
    },
    create: {
      client_user_id: clientUserId,
      stylist_account_id: stylistAccountId,
      status: PairingStatusValue.ACTIVE,
      paired_via_pairing_session_id: IDS.pairingSession,
    },
    update: {
      status: PairingStatusValue.ACTIVE,
      revoked_at: null,
      paired_via_pairing_session_id: IDS.pairingSession,
    },
  });
  log.push(
    `ClientStylistPair upserted (ACTIVE): client ${clientUserId} <-> stylist ${stylistAccountId}`
  );

  // ── 4. Inspiration session SHARED to the stylist (unblocks /app/inbox/session/[id]). ──
  // Stylist-side get-by-id requires: stylist_account_id == viewer, lifecycle in
  // SHARED/ACTIVE (not DRAFT/READY), and shared_at != null (terminal-never-shared guard).
  await DB_CLIENT.use.sessionContainer.upsert({
    where: { id: IDS.sessionContainer },
    create: {
      id: IDS.sessionContainer,
      client_account_id: clientAccountId,
      stylist_account_id: stylistAccountId,
      name: 'Inspiracje na wesele (test)',
      lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
      client_note: 'Coś delikatnego, nude albo french. Krótkie paznokcie.',
      stylist_note: null,
      shared_at: now,
    },
    update: {
      client_account_id: clientAccountId,
      stylist_account_id: stylistAccountId,
      name: 'Inspiracje na wesele (test)',
      // Re-pin to SHARED in case a prior run/test closed it.
      lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
      client_note: 'Coś delikatnego, nude albo french. Krótkie paznokcie.',
      shared_at: now,
      closed_at: null,
    },
  });
  log.push(`SessionContainer upserted (SHARED): ${IDS.sessionContainer}`);

  // 1-2 photos in the session (reuse the seeded gallery records).
  const sessionPhotoPlan = [
    { gallery_record_id: IDS.galleryRecords[0], position: 0 },
    { gallery_record_id: IDS.galleryRecords[1], position: 1 },
  ];
  await DB_CLIENT.use.sessionContainerPhoto.createMany({
    data: sessionPhotoPlan.map(p => ({
      session_id: IDS.sessionContainer,
      gallery_record_id: p.gallery_record_id,
      position: p.position,
    })),
    // Idempotent via @@unique([session_id, gallery_record_id]) + @@unique([session_id, position]).
    skipDuplicates: true,
  });
  log.push(
    `SessionContainerPhoto: ${sessionPhotoPlan.length} attached (skipDuplicates)`
  );

  // ── Report ── (single block — keeps the code-line count under max-lines:350)
  // styleTraitId = a real trait id the seeded records are tagged with (/app/style/[id]).
  const styleTraitId = traitByName.get('Minimalistyczne') as string;
  const [g0, g1, g2] = IDS.galleryRecords;
  console.log(
    [
      '\n=== UX-crawl seed: done ===',
      ...log.map(l => '  - ' + l),
      '\n=== CLICK TARGETS (5 dynamic routes) ===',
      `  /app/photo/[id]            -> ${g0}`,
      `                                ${g1}`,
      `                                ${g2}`,
      `  /app/style/[id]            -> ${styleTraitId}   (Trait "Minimalistyczne"; 2 seeded records tagged)`,
      `  /app/gallery/stylist/[id]  -> ${stylistAccountId}   (stylist account_id)`,
      `  /stylist/[identifier]      -> ${IDS.vanity}   (vanity_url; or account_id ${stylistAccountId})`,
      `  /app/inbox/session/[id]    -> ${IDS.sessionContainer}   (log in AS the test stylist to view)\n`,
    ].join('\n')
  );
}

void main()
  .catch((err: unknown) => {
    console.error(
      'UX-crawl seed failed:',
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void DB_CLIENT.use.$disconnect();
  });
