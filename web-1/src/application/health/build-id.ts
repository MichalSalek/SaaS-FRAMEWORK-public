import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * DECISION: the Next.js BUILD_ID is the identity of the ARTIFACT, not a version number. The
 * deploy gate (`scripts/deploy/deploy-backend`) reads `.next/BUILD_ID` right after the build and
 * compares it with what the LIVE process reports; only that equality proves prod serves the
 * pushed artifact. `uptime_seconds < 300` says only "the process is fresh", and a fresh process
 * can come up on an OLD artifact (Render restart, OOM, `build_failed` on top).
 *
 * We read the FILE, not a constant injected via `next.config` (`env`/`generateBuildId`): it is
 * the same byte the deploy script reads, so no drift and no effect on Next's cache-busting.
 *
 * Public exposure is safe: BUILD_ID is a random hash with no version, stack or secret
 * information (the frontend exposes it in `/_next/static/<buildId>/` anyway).
 */

/** Reported when the artifact cannot be read (including `next dev`). */
export const UNKNOWN_BUILD_ID = 'unknown';

/**
 * Module-level cache: uptime monitors hit health about every 2s, and BUILD_ID
 * does not change for the life of the process. A second bundle of this module
 * (instrumentation versus pages/api) reads the file again and stores the same bytes.
 */
let cachedBuildId: string | null = null;

export const getBuildId = (): string => {
  if (cachedBuildId !== null) {
    return cachedBuildId;
  }

  try {
    const raw = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8');
    const trimmed = raw.trim();
    cachedBuildId = trimmed.length > 0 ? trimmed : UNKNOWN_BUILD_ID;
  } catch {
    // A missing file means dev, or an unusual cwd. Health must still answer:
    // this probe is liveness, not artifact diagnosis. The deploy gate treats
    // 'unknown' as "the artifact was not confirmed" instead of hanging.
    cachedBuildId = UNKNOWN_BUILD_ID;
  }

  return cachedBuildId;
};
