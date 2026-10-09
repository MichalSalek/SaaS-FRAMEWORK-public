import { DB_CLIENT } from '@app/db/db.client';
import { escapeLikePattern } from '@app/db/like-escape';
import { getClientURL } from '@app/debugger/debugger.utils.api';
import { createEventLogRecord_IO } from '@app/debugger/error-handler-io';
import { shouldLogMessage } from '@app/debugger/log-rate-limiter';
import { debuggerStates } from '@app/debugger/debugger.state';
import {
  getCurrentCorrelationId,
  getCurrentRequestReferer,
} from '@app/http/request-context';
import type {
  ADMIN_DTO_API_V1,
  EventLogRecordFromDB,
} from '@kernel/models/admin/admin.dto';
import type { EventLogRecord } from '@kernel/models/db_models.manual.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import {
  LOG_STREAM_DEFAULT_TAKE,
  LOG_STREAM_MAX_TAKE,
  STARTUP_NOISE_NAMESPACES,
} from '@kernel/domain/admin/log-triage.config';
import { getRuntimeConfigValue } from './admin-runtime-config.operations';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { RuntimeConfigKey } from '@kernel/domain/admin/runtime-config.config';

const MAX_AGE_KEY: RuntimeConfigKey = 'EVENT_LOG_MAX_AGE_DAYS';
const MAX_RECORDS_KEY: RuntimeConfigKey = 'EVENT_LOG_MAX_RECORDS';

export const APP_LOG_SELECT = {
  id: true,
  created_at: true,
  event_log_chain_id: true,
  type: true,
  namespace: true,
  message: true,
  payload: true,
  user_metadata: true,
  client_url: true,
  application: true,
  environment: true,
  user_id: true,
} as const;

type AppLogRow = {
  id: number;
  created_at: Date;
  event_log_chain_id: string;
  type: string;
  namespace: string;
  message: string;
  payload: string;
  user_metadata: string;
  client_url: string;
  application: string;
  environment: string;
  user_id: string | null;
};

export const toEventLogRecord = (row: AppLogRow): EventLogRecordFromDB => ({
  ...row,
  id: String(row.id),
});

const utcDayStart = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const utcDayEnd = (day: string): Date => new Date(`${day}T23:59:59.999Z`);

const resolveTake = (take: number | undefined): number => {
  if (take === undefined || !Number.isInteger(take) || take < 1) {
    return LOG_STREAM_DEFAULT_TAKE;
  }
  return Math.min(take, LOG_STREAM_MAX_TAKE);
};

export const adminGetLogs_IO = async ({
  body,
  currentUser,
}: {
  body: ADMIN_DTO_API_V1['GET_LOGS']['REQUEST'];
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    ADMIN_DTO_API_V1['GET_LOGS']['RESPONSE'],
    AdminInsufficientPermissionsError | DatabaseError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    const search = body.search?.trim() ?? '';
    const where = {
      ...(body.environment !== undefined && {
        environment: body.environment,
      }),
      ...(body.application !== undefined && {
        application: body.application,
      }),
      ...(body.type !== undefined && { type: body.type }),
      ...(body.hide_startup_noise === true && {
        namespace: { notIn: [...STARTUP_NOISE_NAMESPACES] },
      }),
      ...(search.length > 0 && {
        OR: [
          {
            message: {
              contains: escapeLikePattern(search),
              mode: 'insensitive' as const,
            },
          },
          {
            namespace: {
              contains: escapeLikePattern(search),
              mode: 'insensitive' as const,
            },
          },
        ],
      }),
      ...((body.date_from !== undefined || body.date_to !== undefined) && {
        created_at: {
          ...(body.date_from !== undefined && {
            gte: utcDayStart(body.date_from),
          }),
          ...(body.date_to !== undefined && { lte: utcDayEnd(body.date_to) }),
        },
      }),
    };
    const hasWhere = Object.keys(where).length > 0;
    const pageWhere =
      body.cursor !== undefined ? { ...where, id: { lt: body.cursor } } : where;
    const take = resolveTake(body.take);

    const [output, totalCount, oldest] = await Promise.all([
      DB_CLIENT.useAppLogs.appLogRecord.findMany({
        ...(hasWhere || body.cursor !== undefined ? { where: pageWhere } : {}),
        orderBy: [{ id: 'desc' }],
        // One extra row tells us whether another page exists without a second scan.
        take: take + 1,
        select: APP_LOG_SELECT,
      }),
      hasWhere
        ? DB_CLIENT.useAppLogs.appLogRecord.count({ where })
        : // DECISION (nie usuwaj tego komentarza):
          // Unfiltered totalCount uses pg_class.reltuples (planner estimate) — tani
          // przybliżony count na potencjalnie ogromnej, szybko rosnącej tabeli logów
          // (filtrowana gałąź robi dokładny count(), bo zawęża zbiór). Postgres >=14
          // zwraca reltuples=-1 jako sentinel "nieznane" dla tabeli nigdy nie poddanej
          // ANALYZE/VACUUM (świeża/pusta), NIE "-1 rekord". Clamp Math.max(0, ...) chroni
          // UI przed ujemnym licznikiem; ?? łapie tylko null/undefined, nie ten sentinel.
          // Query returns 0 rows if relname has no match (defensive): type as a
          // variable-length array so r[0] is correctly `T | undefined`, which the
          // optional chain + ?? 0 fallback below already handles.
          DB_CLIENT.useAppLogs.$queryRaw<Array<{ reltuples: bigint }>>`
            SELECT reltuples::bigint FROM pg_class WHERE relname = 'AppLogRecord'
          `.then(r => Math.max(0, Number(r[0]?.reltuples ?? 0))),
      // To samo zawężenie co `totalCount` — statystyki opisują JEDEN zbiór.
      // Globalna data najstarszego rekordu przy filtrowanym liczniku kłamała:
      // panel pokazywał „12 wpisów od 90 dni", gdzie 90 dni pochodziło z innego
      // środowiska niż te 12 wpisów. Kursor strony NIE wchodzi do tego where:
      // „najstarsze" opisuje cały filtr, nie bieżącą stronę.
      DB_CLIENT.useAppLogs.appLogRecord.findFirst({
        ...(hasWhere && { where }),
        orderBy: { id: 'asc' },
        select: { created_at: true },
      }),
    ]);

    const page = output.slice(0, take);
    const records = page.map(row => toEventLogRecord(row));
    const nextCursor =
      output.length > take ? (page[page.length - 1]?.id ?? null) : null;

    return success({
      records,
      nextCursor,
      totalCount,
      oldestRecordDate: oldest ? oldest.created_at.toISOString() : null,
    });
  } catch (error) {
    return databaseFailure('adminGetLogs', error);
  }
};

// Defensive payload caps for public log ingestion endpoint.
// DECISION (nie usuwaj tego komentarza):
// SEND_LOG sits in BASE_PERMISSIONS (pre-auth client error tracking — anonymous
// users need to ship errors before login). To prevent DB bloat from over-sized
// payloads (intentional or accidental), we cap message (4KB) and payload (8KB)
// at the operation boundary. Truncation marker preserves observability.
// MAX_PAYLOAD_LENGTH is aligned with VALIDATION_LENGTHS.LOG_PAYLOAD_MAX (8000) so
// validation rejects over-sized payloads up-front; this cap is defense-in-depth.
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_PAYLOAD_LENGTH = 8_000;
const TRUNCATED_MARKER = '...[TRUNCATED]';

const capString = (value: string, max: number): string =>
  value.length <= max
    ? value
    : value.slice(0, max - TRUNCATED_MARKER.length) + TRUNCATED_MARKER;

const PAGE_URL_MAX = 2_000;

// The page address a client reports is cut to origin + path here, like
// requestTarget and referer at their source (DECISION in request-context.ts):
// `?authCode=` and magic-link tokens would otherwise sit in AppLogRecord for
// the whole retention period. An older client build may still send them.
const resolveIngestClientUrl = (raw: string | undefined): string => {
  if (typeof raw === 'string') {
    const trimmed = raw.split(/[?#]/)[0]?.trim() ?? '';
    if (trimmed.length > 0) {
      return capString(trimmed, PAGE_URL_MAX);
    }
  }
  return getCurrentRequestReferer() ?? getClientURL();
};

// DECISION (nie usuwaj tego komentarza):
// Namespace prefixes reserved for SERVER-generated dashboard signals (admin health:
// alert_history matches 'ALERT*', email_stats matches 'EMAIL*'). SEND_LOG is anonymous
// (BASE_PERMISSIONS, pre-auth client error reporting) with a free-form namespace, so a
// client could otherwise emit e.g. 'ALERT_FAKE'/'EMAIL_FAKE' rows. The authoritative
// defence is the application='backend' source filter on the consumption side
// (admin-health.operations.ts) — adminSendLog_IO hardcodes application='frontend'. This
// ingestion-side namespace hygiene is defense-in-depth: we DON'T reject (a genuinely
// named client error like 'EMAIL_FORM_VALIDATION' is still observable) — we PREFIX with
// 'CLIENT_' so a frontend log can never structurally collide with a server signal
// namespace, keeping the audit namespace space unambiguous about origin.
const RESERVED_SERVER_NAMESPACE_PREFIXES = ['ALERT', 'EMAIL'] as const;
const CLIENT_NAMESPACE_PREFIX = 'CLIENT_';

const sanitizeClientNamespace = (namespace: string): string => {
  const collides = RESERVED_SERVER_NAMESPACE_PREFIXES.some(prefix =>
    namespace.startsWith(prefix)
  );
  return collides ? `${CLIENT_NAMESPACE_PREFIX}${namespace}` : namespace;
};

export const adminSendLog_IO = async ({
  body,
}: {
  body: ADMIN_DTO_API_V1['SEND_LOG']['REQUEST'];
}): Promise<OperationResult<void, never>> => {
  // Narrow the client-declared severity (DTO types it as string) to the IssueMode
  // union the gates expect; anything unexpected is treated as undefined (no bypass).
  const mode: 'info' | 'warn' | 'error' | undefined =
    body.type === 'info' || body.type === 'warn' || body.type === 'error'
      ? body.type
      : undefined;

  // ONE verbose policy front+back (see docs/LOGGING.md): re-gate client INFO on the
  // SAME VERBOSE_LOG_MODE the client mirrors and the backend syncs into
  // debuggerStates. The client pre-gates too, but the server no longer TRUSTS that —
  // a stale client (still ON after admin flips OFF) can't flood the store with info.
  // warn/error always pass (mode!=='info'). Fail-closed if the flag is off.
  if (mode === 'info' && !debuggerStates.isEnabledDebugMode) {
    return success(undefined);
  }
  // Pass the mode so client ERROR storms get the same throttle-bypass backend errors
  // get (shouldLogMessage exempts 'error'); previously omitted → client errors throttled.
  if (!shouldLogMessage(body.namespace, body.message, mode)) {
    return success(undefined);
  }

  const cappedMessage = capString(body.message, MAX_MESSAGE_LENGTH);
  const cappedPayload = capString(body.payload, MAX_PAYLOAD_LENGTH);

  // Frontend log ingestion: prefer the per-request correlationId set by
  // timing.middleware.ts so that frontend-shipped log lines correlate with
  // the inbound request that delivered them. Fallback '0' marks logs delivered
  // outside any request scope (defensive — not expected in practice).
  // namespace is set AFTER the spread so the reserved-prefix sanitizer wins over
  // the caller-supplied body.namespace (see RESERVED_SERVER_NAMESPACE_PREFIXES).
  const payload: Omit<EventLogRecord, 'id' | 'created_at'> = {
    ...body,
    namespace: sanitizeClientNamespace(body.namespace),
    message: cappedMessage,
    payload: cappedPayload,
    user_id:
      typeof body.user_id === 'string' && body.user_id.length > 0
        ? body.user_id
        : null,
    application: 'frontend',
    event_log_chain_id: getCurrentCorrelationId() ?? '0',
    // The browser sends the page it was actually on. Referer of the ingest
    // request is the fallback (older clients, or a beacon that omitted it).
    client_url: resolveIngestClientUrl(body.client_url),
  };

  void createEventLogRecord_IO(payload).catch(() => {
    // Fire-and-forget: log ingestion failure should not return 500
  });

  return success(undefined);
};

export const cleanupOldEventLogs_IO = async ({
  currentUser,
}: {
  currentUser?: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    { deleted: number },
    AdminInsufficientPermissionsError | DatabaseError
  >
> => {
  if (currentUser) {
    const adminCheck = requireAdminPermission(currentUser);
    if (!adminCheck.success) {
      return adminCheck;
    }
  }

  try {
    const maxAgeDays = Number(await getRuntimeConfigValue(MAX_AGE_KEY, '90'));
    const maxRecords = Number(
      await getRuntimeConfigValue(MAX_RECORDS_KEY, '50000')
    );

    let totalDeleted = 0;

    // DECISION (nie usuwaj tego komentarza):
    // Destructive-wipe guard. maxAgeDays<=0 collapses the cutoff to "now" (or a
    // FUTURE date for negatives) → deleteMany({ created_at: { lt: cutoff } }) would
    // purge the ENTIRE audit/error-tracking table; maxRecords<=0 makes the
    // count>maxRecords branch delete down to zero rows. The validator
    // (NUMERIC_CONFIG_CONSTRAINTS) now enforces min:1, but this consumer-side guard
    // is the authoritative safety net — config can drift via seed, direct DB write,
    // or a future validator change. A "retain nothing" retention window is never a
    // meaningful operator intent (the config descriptions are a deletion BOUNDARY,
    // not a wipe switch), so a non-positive value is treated as "skip this sweep
    // dimension", never "delete everything".
    if (maxAgeDays >= 1) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - maxAgeDays);
      const ageResult = await DB_CLIENT.useAppLogs.appLogRecord.deleteMany({
        where: { created_at: { lt: cutoff } },
      });
      totalDeleted += ageResult.count;

      // DECISION (nie usuwaj tego komentarza):
      // Sprzątamy WYŁĄCZNIE wiersze-widma triage'u: opis 'unknown' powstawał tylko
      // wtedy, gdy status nadano odciskowi palca BEZ ani jednego pasującego logu
      // (kolumna `application` w realnym logu to zawsze 'frontend'/'backend' —
      // LOG_APPLICATIONS). Takich wierszy nie widać w panelu, bo lista grup powstaje
      // z logów, więc nikt ich nigdy nie skasuje ręcznie. Nowe już nie powstają
      // (adminSetLogIssueStatus_IO odrzuca zakładanie wiersza bez logów) — to sprzątanie
      // po starym zachowaniu. Wierszy OSIEROCONYCH przez retencję świadomie NIE ruszamy:
      // model LogIssueStatus z założenia żyje dłużej niż logi, żeby powrót błędu po
      // miesiącach pokazał się jako `regressed`, a nie jako nowa sprawa (patrz komentarz
      // przy modelu w schema.prisma). Nie doliczamy tego do `deleted` — ta liczba opisuje
      // usunięte LOGI i trafia do panelu retencji.
      await DB_CLIENT.useAppLogs.logIssueStatus.deleteMany({
        where: { application: 'unknown', updated_at: { lt: cutoff } },
      });
    }

    const totalCount = await DB_CLIENT.useAppLogs.appLogRecord.count();
    if (maxRecords >= 1 && totalCount > maxRecords) {
      const excess = totalCount - maxRecords;
      // Cap batch to prevent OOM; cleanup is idempotent — next run finishes excess.
      // Single DELETE with subquery avoids TOCTOU between count/findMany/deleteMany.
      const deleted = await DB_CLIENT.useAppLogs.$executeRaw`
        DELETE FROM "AppLogRecord"
        WHERE id IN (
          SELECT id FROM "AppLogRecord"
          ORDER BY id ASC
          LIMIT ${Math.min(excess, 10_000)}::int
        )
      `;
      totalDeleted += deleted;
    }

    return success({ deleted: totalDeleted });
  } catch (error) {
    return databaseFailure('cleanupOldEventLogs', error);
  }
};
