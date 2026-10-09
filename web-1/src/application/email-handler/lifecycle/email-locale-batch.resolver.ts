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
  userIds: string[]
): Promise<Map<string, LocaleType>> => {
  const localeMap = new Map<string, LocaleType>();
  if (userIds.length === 0) {
    return localeMap;
  }

  try {
    // Fetch the latest EventLog `language` per user — RAW DISTINCT ON.
    // DECISION (nie usuwaj tego komentarza): Prisma 7 + adapter-pg (bez
    // nativeDistinct) NIE kompiluje `distinct` do SQL — dedup jest IN-MEMORY,
    // więc poprzednie findMany+distinct (S81) streamowało CAŁĄ historię
    // language każdego usera do Node (closing-review S82: probe SQL na żywym
    // kliencie pokazał zapytanie bez DISTINCT/LIMIT; komentarz o "pushes the
    // dedup down to SQL" był fałszywy na tym stacku). $queryRaw z prawdziwym
    // DISTINCT ON zwraca <= userIds.length wierszy z bazy. Parametry związane
    // (tagged template — zero injection); błąd raw SQL degraduje gracefully
    // przez istniejący catch → wszyscy dostają 'pl'.
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
    // DEGRADACJA ZOSTAJE, CISZA NIE (nie usuwaj tego komentarza):
    // fallback jest właściwy — awaria odczytu języka nie może zablokować wysyłki
    // cyklu życia, więc paczka idzie dalej. Ale porażka była CAŁKOWICIE niema, a jej
    // skutek jest widoczny dla odbiorcy: KAŻDY user w paczce dostaje maila po polsku,
    // łącznie z tymi, którzy mają ustawione EN/DE. Objaw („dlaczego Niemcy dostali
    // polskiego maila") nie miał w logach żadnego odpowiednika, więc nie dawał się
    // zdiagnozować post factum. Raportujemy jako `error`: to nie jest spodziewany
    // stan, tylko awaria zapytania (raw SQL / niedostępna baza).
    reportIssueBackend({
      namespace: 'EMAIL_LOCALE_BATCH_FALLBACK',
      message: `Locale batch-resolve failed for ${userIds.length} user(s) — whole batch falls back to the default locale`,
      payload: {
        userCount: userIds.length,
        error: error instanceof Error ? error.message : String(error),
      },
      mode: 'error',
    });
  }

  return localeMap;
};
