/**
 * Email Locale Resolver
 *
 * Shared, fail-open resolver of a recipient's preferred locale by email
 * address. Used by the magic-link adapter and by sendTransactionalEmail
 * (default when the caller does not pass an explicit locale).
 */

import { DB_CLIENT } from '@app/db/db.client';
import {
  getLocaleOrDefault,
  type LocaleType,
} from '@kernel/domain/i18n/i18n.config';

/**
 * Resolve the recipient's preferred locale from their latest EventLog `language`.
 *
 * Mirrors the batch resolver in email-lifecycle.orchestrator.ts (single-user variant):
 * latest non-null `language` EventLog for the user wins; everything else falls back to
 * the default locale (pl) via getLocaleOrDefault.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Locale resolution MUST be fail-open. Any failure (user not found, no language
 * logged, DB error) returns the default locale (pl) and NEVER throws, so a locale
 * lookup hiccup can never block an email from being sent. Critical for the
 * magic-link path (SOLE login path) and inherited by every transactional email.
 * Cost: 2 indexed queries (user by unique email + latest eventLog) — acceptable,
 * since transactional sends are awaited/retried network calls anyway and most
 * run post-commit / fire-and-forget.
 */
export const resolveLocaleByEmail = async (
  email: string
): Promise<LocaleType> => {
  try {
    const user = await DB_CLIENT.use.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) {
      return getLocaleOrDefault(undefined);
    }

    const log = await DB_CLIENT.use.eventLog.findFirst({
      where: {
        created_by_user_id: user.id,
        language: { not: null },
      },
      orderBy: { created_at: 'desc' },
      select: { language: true },
    });

    return getLocaleOrDefault(log?.language ?? undefined);
  } catch {
    // Fail-open: never block an email send on a locale lookup error.
    return getLocaleOrDefault(undefined);
  }
};
