import { Prisma } from '../../../prisma-app-logs/js-client';
import { TIME } from '@kernel/application/constants.config';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import {
  LOG_ATTENTION_SCOPE,
  LOG_GROUPS_LIMIT,
  LOG_ISSUE_ATTENTION_STATUSES,
  type LogIssueDisplayStatus,
} from '@kernel/domain/admin/log-triage.config';
import {
  FIXED_LOG_ISSUE_STATUS,
  logIssueDisplayStatus,
  logIssueDisplayStatusSql,
} from './admin-log-display-status.helper';

type GroupsRequest = ADMIN_DTO_API_V1['ADMIN_GET_LOG_GROUPS']['REQUEST'];

// DECISION (nie usuwaj tego komentarza):
// Normalizacja wiadomości PRZED policzeniem odcisku palca. Bez niej grupowanie
// rozsypuje się na wariantach tej samej klasy błędu: „Seeding complete in 8741ms"
// i „…9008ms" to jedno zdarzenie, a nie dwa. Kolejność podstawień jest istotna —
// UUID zawiera cyfry, więc gdyby najpierw poleciał `\d+`, wzorzec UUID już by nie
// pasował i zostałby rozbity na kawałki.
// Podstawienia są CELOWO wąskie (identyfikatory i liczby), żeby nie skleić ze sobą
// dwóch różnych błędów o podobnym szkielecie zdania.
//
// Reguła tokenowa wymaga, by ciąg 20+ znaków ZAWIERAŁ CYFRĘ (lookahead) — sam limit
// długości był za szeroki i zjadał nazwy operacji: `getFeatureFlagsPublic` (21 zn.)
// i `getActiveAnnouncements_IO` (25 zn.) zlewały się w jedną grupę `<id>: quota
// exceeded`, przez co pięć różnych awarii pokazywało się jako jedna (447 wystąpień
// zamiast rozbicia na operacje). Tokeny sesji i identyfikatory cyfrę mają, nazwy
// funkcji w camelCase zwykle nie.
export const NORMALIZED_MESSAGE_SQL = Prisma.sql`
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          message,
          '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
          '<uuid>', 'g'
        ),
        '(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{20,}', '<id>', 'g'
      ),
      '[0-9a-fA-F]{16,}', '<hex>', 'g'
    ),
    '\\d+', '<n>', 'g'
  )
`;

/**
 * Fingerprint of one AppLogRecord row. `messageSql` is either
 * NORMALIZED_MESSAGE_SQL or the CTE alias `norm` (that alias IS the
 * normalized message — do not inline a second copy of the regex).
 */
export const appLogFingerprintSql = (messageSql: Prisma.Sql): Prisma.Sql =>
  Prisma.sql`md5(application || '|' || type || '|' || namespace || '|' || ${messageSql})`;

export type LogGroupRow = {
  fingerprint: string;
  application: string;
  type: string;
  namespace: string;
  sample_message: string;
  sample_id: number | bigint;
  count: bigint;
  first_seen: Date;
  last_seen: Date;
  /** Najświeższe wystąpienie klasy błędu we WSZYSTKICH środowiskach — patrz DECISION przy logIssueDisplayStatus. */
  last_seen_any: Date | null;
  stored_status: string | null;
  note: string | null;
  status_updated_at: Date | null;
  total_groups: bigint;
};

/**
 * What one grouped query looks at. `since` and `onlyNeedingReaction` are set
 * together by the attention scope and stay empty for the ordinary panel.
 */
export type LogGroupsScope = {
  environment?: string | undefined;
  application?: string | undefined;
  type?: string | undefined;
  since?: Date | undefined;
  onlyNeedingReaction: boolean;
};

/**
 * Request -> scope. With `attention: true` the client's own dimensions are
 * IGNORED and the kernel scope is forced (LOG_ATTENTION_SCOPE), so the list
 * the badge links to cannot be widened or narrowed away from the badge.
 */
export const resolveLogGroupsScope = (
  body: GroupsRequest,
  now: Date
): LogGroupsScope =>
  body.attention === true
    ? {
        environment: LOG_ATTENTION_SCOPE.environment,
        type: LOG_ATTENTION_SCOPE.type,
        since: new Date(
          now.getTime() - LOG_ATTENTION_SCOPE.windowDays * TIME.MS_PER_DAY
        ),
        onlyNeedingReaction: true,
      }
    : {
        environment: body.environment,
        application: body.application,
        type: body.type,
        onlyNeedingReaction: false,
      };

const buildScopeFilter = (scope: LogGroupsScope): Prisma.Sql => {
  const conditions: Prisma.Sql[] = [];
  if (scope.environment) {
    conditions.push(Prisma.sql`environment = ${scope.environment}`);
  }
  if (scope.application) {
    conditions.push(Prisma.sql`application = ${scope.application}`);
  }
  if (scope.type) {
    conditions.push(Prisma.sql`type = ${scope.type}`);
  }
  if (scope.since) {
    conditions.push(Prisma.sql`created_at >= ${scope.since}`);
  }
  return conditions.length === 0
    ? Prisma.empty
    : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
};

/**
 * THE grouped relation: one row per error class inside the scope, with its
 * triage row, the global regression evidence and the display status. Ends in
 * the CTE `visible`; the list and the count below only choose what to SELECT
 * from it.
 *
 * DECISION (nie usuwaj tego komentarza):
 * One builder for the list AND for the menu badge (S126). They used to be two
 * hand-written queries that drifted: the badge judged regression on its own
 * 7-day PRODUCTION slice while the panel used the global evidence, and the
 * panel had no time window at all, so "Logi (3)" opened a list of something
 * else. Now the badge is `count(*)` over the very relation the attention list
 * pages through, and the "needs a reaction" filter sits inside the relation,
 * before any LIMIT.
 */
export const buildLogGroupsRelation = (scope: LogGroupsScope): Prisma.Sql =>
  Prisma.sql`
      WITH scoped AS (
        SELECT
          id,
          application,
          type,
          namespace,
          message,
          created_at,
          ${NORMALIZED_MESSAGE_SQL} AS norm
        FROM "AppLogRecord"
        ${buildScopeFilter(scope)}
      ),
      grouped AS (
        SELECT
          ${appLogFingerprintSql(Prisma.sql`norm`)} AS fingerprint,
          application,
          type,
          namespace,
          count(*)::bigint AS count,
          min(created_at) AS first_seen,
          max(created_at) AS last_seen,
          (array_agg(message ORDER BY created_at DESC))[1] AS sample_message,
          (array_agg(id ORDER BY created_at DESC))[1] AS sample_id
        FROM scoped
        GROUP BY 1, 2, 3, 4
      ),
      -- Dowód regresji liczony POZA zawężeniem panelu (patrz DECISION przy
      -- logIssueDisplayStatus). Semi-join po polach opisowych wiersza statusu
      -- przycina to do klas błędów faktycznie oznaczonych jako naprawione —
      -- reszta tabeli nie przechodzi przez regexpy drugi raz.
      fixed_activity AS (
        SELECT
          ${appLogFingerprintSql(NORMALIZED_MESSAGE_SQL)} AS fingerprint,
          max(created_at) AS last_seen_any
        FROM "AppLogRecord" r
        WHERE EXISTS (
          SELECT 1 FROM "LogIssueStatus" s
          WHERE s.status = ${FIXED_LOG_ISSUE_STATUS}
            AND s.application = r.application
            AND s.type = r.type
            AND s.namespace = r.namespace
        )
        GROUP BY 1
      ),
      labeled AS (
        SELECT
          grp.fingerprint,
          grp.application,
          grp.type,
          grp.namespace,
          grp.sample_message,
          grp.sample_id,
          grp.count,
          grp.first_seen,
          grp.last_seen,
          fa.last_seen_any,
          s.status AS stored_status,
          s.note,
          s.updated_at AS status_updated_at,
          -- Fallback to the last_seen of the slice mirrors resolveLogGroupStatus.
          ${logIssueDisplayStatusSql({
            storedStatus: Prisma.sql`s.status`,
            statusUpdatedAt: Prisma.sql`s.updated_at`,
            lastSeen: Prisma.sql`COALESCE(fa.last_seen_any, grp.last_seen)`,
          })} AS display_status
        FROM grouped grp
        LEFT JOIN "LogIssueStatus" s ON s.fingerprint = grp.fingerprint
        LEFT JOIN fixed_activity fa ON fa.fingerprint = grp.fingerprint
      ),
      visible AS (
        SELECT * FROM labeled
        ${
          scope.onlyNeedingReaction
            ? Prisma.sql`WHERE display_status IN (${Prisma.join([...LOG_ISSUE_ATTENTION_STATUSES])})`
            : Prisma.empty
        }
      )`;

/**
 * The page of groups. `count(*) OVER ()` counts the groups BEFORE the LIMIT,
 * so the UI knows the list is cut without a second pass over the table.
 */
export const buildLogGroupsListQuery = (scope: LogGroupsScope): Prisma.Sql =>
  Prisma.sql`${buildLogGroupsRelation(scope)}
      SELECT
        g.fingerprint,
        g.application,
        g.type,
        g.namespace,
        g.sample_message,
        g.sample_id,
        g.count,
        g.first_seen,
        g.last_seen,
        g.last_seen_any,
        g.stored_status,
        g.note,
        g.status_updated_at,
        count(*) OVER ()::bigint AS total_groups
      FROM visible g
      -- Odcisk palca jako ostatni klucz sortowania: bez niego grupy o identycznej
      -- liczbie wystąpień i tej samej dacie ostatniego wystąpienia ustawiają się
      -- w kolejności, jaką akurat zwróci planer, więc przy cięciu na LIMIT jedna
      -- z nich mruga na liście między odświeżeniami.
      ORDER BY g.count DESC, g.last_seen DESC, g.fingerprint
      LIMIT ${LOG_GROUPS_LIMIT}
    `;

/** How many groups the same relation holds (the menu badge). */
export const buildLogGroupsCountQuery = (scope: LogGroupsScope): Prisma.Sql =>
  Prisma.sql`${buildLogGroupsRelation(scope)}
      SELECT count(*)::int AS open_groups FROM visible
    `;

/**
 * Row -> display status. Falls back to `last_seen` only for a row with no
 * global evidence (a status given to a fingerprint whose class has no `fixed`
 * row to semi-join on); the group is in the result, so its occurrence in the
 * slice is the only evidence there is.
 */
export const resolveLogGroupStatus = (
  row: LogGroupRow
): LogIssueDisplayStatus =>
  logIssueDisplayStatus({
    storedStatus: row.stored_status,
    statusUpdatedAt: row.status_updated_at,
    lastSeen: row.last_seen_any ?? row.last_seen,
  });
