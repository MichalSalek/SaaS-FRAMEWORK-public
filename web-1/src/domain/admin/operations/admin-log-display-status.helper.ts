import { Prisma } from '../../../prisma-app-logs/js-client';
import {
  DEFAULT_LOG_ISSUE_STATUS,
  LOG_ISSUE_REGRESSED,
  LOG_ISSUE_STATUSES,
  isLogIssueStatus,
  type LogIssueDisplayStatus,
  type LogIssueStatusValue,
} from '@kernel/domain/admin/log-triage.config';

/** Jedyny status, dla którego liczymy regresję (reszta nie ma czego „cofnąć"). */
export const FIXED_LOG_ISSUE_STATUS: LogIssueStatusValue = 'fixed';

/**
 * Status pokazywany w UI. `regressed` jest POCHODNY i nigdy nie trafia do bazy:
 * grupa oznaczona jako naprawiona, która wystąpiła ponownie PO tym oznaczeniu,
 * musi się sama zgłosić — inaczej „naprawione" byłoby deklaracją bez pokrycia.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Odcisk palca CELOWO nie zawiera `environment`, a status jest jeden na klasę błędu
 * we wszystkich środowiskach. Status opisuje KOD, nie instancję wdrożenia — ten sam
 * błąd na devie i na produkcji naprawia jedna zmiana, więc triage per-środowisko
 * kazałby oznaczać tę samą awarię trzy razy (i rozjeżdżałby wiersze statusu przy
 * każdej zmianie filtra w panelu). Konsekwencja, którą trzeba domknąć: skoro status
 * jest globalny, dowód regresji też MUSI być globalny — inaczej ten sam wiersz
 * pokazywałby „fixed" przy filtrze PRODUCTION i „regressed" bez filtra, bo `last_seen`
 * liczy się na zawężonym zbiorze. Dlatego werdykt bierze `last_seen_any` (maksimum po
 * całej tabeli, CTE `fixed_activity`), a `last_seen` zostaje wyłącznie informacją
 * „kiedy ostatnio w TYM wycinku". Kierunek błędu jest świadomy: nawrót w dowolnym
 * środowisku po oznaczeniu „naprawione" gasi tę deklarację (fałszywe „regressed"
 * jest tańsze niż fałszywe „naprawione").
 */
export const logIssueDisplayStatus = (input: {
  storedStatus: string | null;
  statusUpdatedAt: Date | null;
  lastSeen: Date;
}): LogIssueDisplayStatus => {
  if (!isLogIssueStatus(input.storedStatus)) {
    return DEFAULT_LOG_ISSUE_STATUS;
  }
  if (
    input.storedStatus === FIXED_LOG_ISSUE_STATUS &&
    input.statusUpdatedAt !== null &&
    input.lastSeen.getTime() > input.statusUpdatedAt.getTime()
  ) {
    return LOG_ISSUE_REGRESSED;
  }
  return input.storedStatus;
};

/**
 * The SAME rule as logIssueDisplayStatus, as a SQL expression.
 *
 * DECISION (nie usuwaj tego komentarza):
 * The rule exists twice on purpose, and only here. The JS function stays the
 * single definition used to label rows for the response. The SQL twin exists
 * because "needs a reaction" must be filtered BEFORE the LIMIT and counted
 * without materializing groups, which only the database can do. Both are
 * built from the same kernel constants, and a unit test evaluates this CASE
 * for every status combination against the JS function
 * (admin-log-groups.query.test.ts). Change one, the test names the other.
 * The three column expressions are passed in so the test can feed values.
 */
export const logIssueDisplayStatusSql = (columns: {
  storedStatus: Prisma.Sql;
  statusUpdatedAt: Prisma.Sql;
  lastSeen: Prisma.Sql;
}): Prisma.Sql => Prisma.sql`CASE
      WHEN ${columns.storedStatus} IS NULL OR ${columns.storedStatus} NOT IN (${Prisma.join([...LOG_ISSUE_STATUSES])}) THEN ${DEFAULT_LOG_ISSUE_STATUS}::text
      WHEN ${columns.storedStatus} = ${FIXED_LOG_ISSUE_STATUS} AND ${columns.statusUpdatedAt} IS NOT NULL AND ${columns.lastSeen} > ${columns.statusUpdatedAt} THEN ${LOG_ISSUE_REGRESSED}::text
      ELSE ${columns.storedStatus}
    END`;
