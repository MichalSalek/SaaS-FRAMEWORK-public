// SSOT triage'u logów: wymiary filtrowania panelu admina, statusy grup błędów
// i lista przestrzeni nazw uznanych za szum operacyjny.
//
// Kontekst (nie usuwaj): panel logów pokazywał surowy strumień z filtrem po
// typie i dacie, bez sposobu na oddzielenie frontu od backendu, produkcji od
// developmentu i jednej klasy błędu od jej powtórzeń.

import type { SendLogType } from './send-log.config';

/** Warstwa, z której przyszedł log. Wartości kolumny `AppLogRecord.application`. */
export const LOG_APPLICATIONS = ['frontend', 'backend'] as const;
export type LogApplication = (typeof LOG_APPLICATIONS)[number];

/**
 * Środowiska, po których panel filtruje logi (kolumna środowiska w log-store).
 * Mirror `EnvironmentMode` z web-1 bez sentinela `UNKNOWN` (nie jest wyborem usera).
 */
export const LOG_ENVIRONMENTS = [
  'PRODUCTION',
  'STAGING',
  'DEVELOPMENT',
] as const;
export type LogEnvironment = (typeof LOG_ENVIRONMENTS)[number];

/**
 * Status grupy błędów nadawany ręcznie przez admina.
 *
 * `new` jest stanem DOMYŚLNYM i celowo NIE jest zapisywany w bazie — brak wiersza
 * `LogIssueStatus` == `new`. Dzięki temu cofnięcie oznaczenia to skasowanie wiersza,
 * a tabela statusów nie puchnie o wpisy nic nie wnoszące.
 */
export const LOG_ISSUE_STATUSES = ['new', 'known', 'fixed', 'ignored'] as const;
export type LogIssueStatusValue = (typeof LOG_ISSUE_STATUSES)[number];

export const DEFAULT_LOG_ISSUE_STATUS: LogIssueStatusValue = 'new';

/**
 * Status POCHODNY, nigdy nie zapisywany: grupa oznaczona jako `fixed`, która
 * wystąpiła PONOWNIE po dacie oznaczenia. Bez tego „naprawione" byłoby deklaracją
 * bez pokrycia — nawrót wyglądałby na zamknięty temat.
 */
export const LOG_ISSUE_REGRESSED = 'regressed' as const;

export type LogIssueDisplayStatus =
  LogIssueStatusValue | typeof LOG_ISSUE_REGRESSED;

/** Statusy oznaczające „temat zamknięty" — domyślnie odsiewane z listy do ogarnięcia. */
export const SETTLED_LOG_ISSUE_STATUSES: readonly LogIssueDisplayStatus[] = [
  'fixed',
  'ignored',
] as const;

/**
 * DECISION (nie usuwaj tego komentarza):
 * ONE definition of "a log group that needs a reaction" (S126). The admin menu
 * badge `log_issues_open` and the log panel opened with `attention=1` share
 * these three constants and one backend query builder
 * (admin-log-groups.query.ts), so the number in the menu always equals the
 * number of rows the link shows. Before, the badge counted PRODUCTION errors of
 * the last 7 days while the panel listed every environment with no time window,
 * and the owner saw "Logi (3)" over a list of something else.
 *
 * `known` and `ignored` are decisions the admin already took, `fixed` is closed
 * until the error comes back (then it is `regressed`). That is why this set is
 * NOT the complement of SETTLED_LOG_ISSUE_STATUSES: `known` is neither settled
 * nor waiting.
 */
export const LOG_ATTENTION_SCOPE = Object.freeze({
  type: 'error',
  environment: 'PRODUCTION',
  windowDays: 7,
} as const satisfies {
  type: SendLogType;
  environment: LogEnvironment;
  windowDays: number;
});

export const LOG_ISSUE_ATTENTION_STATUSES: readonly LogIssueDisplayStatus[] = [
  DEFAULT_LOG_ISSUE_STATUS,
  LOG_ISSUE_REGRESSED,
] as const;

export const isLogIssueNeedingReaction = (
  displayStatus: LogIssueDisplayStatus
): boolean => LOG_ISSUE_ATTENTION_STATUSES.includes(displayStatus);

/**
 * Przestrzenie nazw zapisywane przy KAŻDYM starcie procesu. Nie są błędami —
 * to potwierdzenia sekwencji seedowania, celowo logowane jako `warn`, bo kanał
 * `info` jest bramkowany flagą VERBOSE_LOG_MODE (patrz docs/LOGGING.md).
 * Na produkcji dają ~8 wpisów na każdy cold-start i zagłuszają realne ostrzeżenia,
 * dlatego panel pozwala je jednym kliknięciem schować.
 */
export const STARTUP_NOISE_NAMESPACES: readonly string[] = [
  'STARTUP',
  'STARTUP_SEEDING_DURATION',
  'PERMISSIONS',
  'runtime-config-seed',
] as const;

/** Ile grup błędów zwraca agregacja (bounduje zapytanie i payload). */
export const LOG_GROUPS_LIMIT = 200;

/** Page size of the admin log stream when the client omits `take`. */
export const LOG_STREAM_DEFAULT_TAKE = 50;

/** Hard cap of one stream page. */
export const LOG_STREAM_MAX_TAKE = 200;

/** Other events of the same request chain returned with one log's details. */
export const LOG_DETAILS_CHAIN_LIMIT = 50;

/** Newest siblings of the same fingerprint returned with one log's details. */
export const LOG_DETAILS_RECENT_LIMIT = 10;

/**
 * How far back the details view counts siblings of one fingerprint. Equals the
 * default log retention (EVENT_LOG_MAX_AGE_DAYS), so normally it cuts nothing;
 * it lets the scan use the (type, created_at) index range instead of the
 * whole table when retention is raised.
 */
export const LOG_DETAILS_GROUP_WINDOW_DAYS = 90;

/** Maksymalna długość notatki przy statusie grupy. */
export const LOG_ISSUE_NOTE_MAX_LENGTH = 500;

export const isLogIssueStatus = (
  value: unknown
): value is LogIssueStatusValue =>
  typeof value === 'string' &&
  (LOG_ISSUE_STATUSES as readonly string[]).includes(value);

export const isLogApplication = (value: unknown): value is LogApplication =>
  typeof value === 'string' &&
  (LOG_APPLICATIONS as readonly string[]).includes(value);

export const isLogEnvironment = (value: unknown): value is LogEnvironment =>
  typeof value === 'string' &&
  (LOG_ENVIRONMENTS as readonly string[]).includes(value);
