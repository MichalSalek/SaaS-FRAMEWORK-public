/**
 * CLI wrapper: thin executor dla backfillCachedCounts_IO.
 *
 * Self-healing pattern: backfill auto-uruchamia sie na kazdy boot przez
 * instrumentation.ts (z 24h throttle + DB advisory lock). Ten skrypt
 * pozostaje do manual triggering w wyjątkowych sytuacjach (debug,
 * dry-run analizy, jednorazowy resync po incydencie).
 *
 * Usage (requires DATABASE_URL in env):
 *   DATABASE_URL=<url> npx tsx scripts/backfill-cached-counts.ts
 *   # or via npm script from web-1/:
 *   npm run db:backfill:cached-counts
 */

import { backfillCachedCounts_IO } from '../src/application/startup/cached-counts-backfill.js';
import { DB_CLIENT } from '../src/application/db/db.client.js';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('Missing DATABASE_URL env var');
  }

  console.log('--- Backfill: cached_bookmark_count + cached_gallery_count ---');

  try {
    await DB_CLIENT.use.$connect();
    console.log('DB connected.');

    const result = await backfillCachedCounts_IO(
      (batchIndex, processed, updated) => {
        const skipped = processed - updated;
        console.log(
          `Batch ${batchIndex}: processed=${processed}, updated=${updated}, skipped=${skipped}`
        );
      }
    );

    console.log('--- Done ---');
    console.log(`Total batches            : ${result.batches}`);
    console.log(`Total accounts processed : ${result.processed}`);
    console.log(`Total updated            : ${result.updated}`);
    console.log(`Total skipped (in sync)  : ${result.skipped}`);
  } finally {
    await DB_CLIENT.use.$disconnect();
  }
}

void main().catch((err: unknown) => {
  console.error('Backfill failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
