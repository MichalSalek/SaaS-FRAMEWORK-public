/**
 * Email Locale Batch Resolver
 *
 * SRP: batch-resolve a user's preferred locale from their latest EventLog
 * `language` field. One query for N users (M12 fix) instead of N per-user lookups.
 *
 * Single-user variant: email-handler/email-locale.resolver.ts.
 */

import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';

/**
 * Batch-resolve locales for multiple users from their latest EventLog language field.
 * Single query instead of N queries (M12 fix).
 * Falls back to 'pl' for users without language info.
 */
export const batchResolveLocales = async (
  userIds: string[],
  options: { strict?: boolean } = {}
): Promise<Map<string, LocaleType>> => {
  const localeMap = new Map<string, LocaleType>();
  if (userIds.length === 0) {
    return localeMap;
  }

  try {
    // Fetch the latest EventLog `language` per user — RAW DISTINCT ON.
    // DECISION: raw DISTINCT ON, not findMany+distinct. Prisma 7 with adapter-pg (no
    // nativeDistinct) does not compile `distinct` to SQL; dedup is in-memory, so the Prisma form
    // streamed the whole language history of every user into Node. $queryRaw returns at most
    // userIds.length rows; params are bound (tagged template); a raw SQL error degrades through
    // the existing catch to 'pl' for everyone.
    const logs = await DB_CLIENT.use.$queryRaw<
      Array<{ created_by_user_id: string; language: string | null }>
    >`
      SELECT DISTINCT ON (created_by_user_id)
        created_by_user_id, language
      FROM "EventLog"
      WHERE created_by_user_id = ANY(${userIds})
        AND language IS NOT NULL
      ORDER BY created_by_user_id ASC, created_at DESC
    `;

    // One row per user (the newest, via trailing created_at DESC).
    for (const log of logs) {
      if (!localeMap.has(log.created_by_user_id) && log.language) {
        localeMap.set(log.created_by_user_id, getLocaleOrDefault(log.language));
      }
    }
  } catch (error) {
    // DECISION: degradation stays, silence does not. The fallback is right (a failed language
    // read must not block the lifecycle send, so the batch goes on), but a silent failure sends
    // EVERY user in the batch a Polish mail, EN/DE users included, with no log to diagnose "why did
    // Germans get a Polish mail". Reported as `error`: it is a query failure (raw SQL / database
    // unavailable), not an expected state.
    reportIssueBackend({
      namespace:
        options.strict === true
          ? 'EMAIL_LOCALE_BATCH_FAILED'
          : 'EMAIL_LOCALE_BATCH_FALLBACK',
      message:
        options.strict === true
          ? `Locale batch-resolve failed for ${userIds.length} user(s); broadcast aborted`
          : `Locale batch-resolve failed for ${userIds.length} user(s) — whole batch falls back to the default locale`,
      payload: {
        userCount: userIds.length,
        error: error instanceof Error ? error.message : String(error),
      },
      mode: 'error',
    });
    // A one-shot broadcast must roll back instead of permanently marking a fallback population sent.
    if (options.strict === true) {
      throw error;
    }
  }

  return localeMap;
};
