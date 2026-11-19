import { DB_CLIENT } from '@app/db/db.client';
import { getAdminEmails } from '@app/admin/admin.utils.api';

let cachedSystemActorId: string | undefined;

/**
 * Resolves a durable DB user id to attribute SYSTEM events to — events with no
 * human actor (scheduled sweeps, circuit-breaker trips, admin digests, anomaly
 * alerts). Without a real created_by_user_id the event_log write is silently
 * skipped (writeRawEventLog_IO guard), defeating EventLog-based dedup + audit.
 * Uses the first Master Admin (seeded at startup). Caches only a successful
 * lookup (never caches a null, so a cold-start before seeding self-heals).
 * Returns undefined if unconfigured → event then safely skips, as before.
 */
export const resolveSystemActorId_IO = async (): Promise<
  string | undefined
> => {
  if (cachedSystemActorId) {
    return cachedSystemActorId;
  }
  const emails = getAdminEmails();
  const firstAdminEmail = emails[0];
  if (firstAdminEmail === undefined) {
    return undefined;
  }
  const admin = await DB_CLIENT.use.user.findUnique({
    where: { email: firstAdminEmail },
    select: { id: true },
  });
  cachedSystemActorId = admin?.id ?? undefined;
  return cachedSystemActorId;
};
