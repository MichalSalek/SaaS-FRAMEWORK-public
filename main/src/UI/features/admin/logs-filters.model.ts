// UI/features/admin/logs-filters.model.ts
// Czysta logika filtrów panelu logów: definicje presetów, rozstrzyganie, który
// preset jest „wciśnięty", oraz filtrowanie po stronie klienta.
//
// DECISION (nie usuwaj tego komentarza):
// Preset NIE trzyma własnego stanu boolean. Jest „wciśnięty" wtedy i tylko wtedy,
// gdy CAŁY jego zestaw twierdzeń pokrywa się z aktualnymi filtrami. Dzięki temu
// ręczna zmiana selecta odciska preset sama z siebie, zamiast zostawiać zapalony
// przycisk opisujący stan, którego już nie ma. Zwolnienie presetu czyści wyłącznie
// to, co on ustawił — pozostałe wymiary zostają nietknięte.

import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import type { LogIssueGroup } from '@kernel/models/admin/admin-logs.dto';
import type { EventLogRecordFromDB } from '@kernel/models/admin/admin.dto';
import {
  isLogApplication,
  isLogEnvironment,
  SETTLED_LOG_ISSUE_STATUSES,
  STARTUP_NOISE_NAMESPACES,
} from '@kernel/domain/admin/log-triage.config';
import { isSendLogType } from '@kernel/domain/admin/send-log.config';
import {
  ADMIN_LOGS_FLAG_ON,
  ADMIN_LOGS_QUERY,
  ADMIN_LOGS_VIEW_GROUPS,
} from '@kernel/domain/admin/admin-logs-url.config';

export type LogsScope = ADMIN_DTO_API_V1['GET_LOGS']['REQUEST'];

export type LogsLocalFilters = {
  search: string;
  dateFrom: string;
  dateTo: string;
  hideStartupNoise: boolean;
  onlyOpenIssues: boolean;
};

export type LogsViewMode = 'stream' | 'groups';

export type QuickFilterId =
  'prodFailures' | 'prodBackend' | 'lastDay' | 'noStartupNoise' | 'openIssues';

type QuickFilter = {
  id: QuickFilterId;
  labelKey: string;
  availableIn: 'both' | LogsViewMode;
  scope: Partial<LogsScope>;
  /** Twierdzenia o filtrach lokalnych; `now` pozwala trzymać funkcję czystą. */
  local: (now: Date) => Partial<LogsLocalFilters>;
};

const noLocal = (): Partial<LogsLocalFilters> => ({});

/** `YYYY-MM-DD` w czasie lokalnym — format akceptowany przez `<input type="date">`. */
export const toDateInputValue = (date: Date): string => {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const yesterday = (now: Date): string => {
  const from = new Date(now);
  from.setDate(from.getDate() - 1);
  return toDateInputValue(from);
};

// Presety opisują SYTUACJE, nie pojedyncze wymiary — te ostatnie mają własne
// selecty i dublowanie ich przyciskiem byłoby tylko drugim sposobem na to samo.
export const QUICK_FILTERS: readonly QuickFilter[] = [
  {
    id: 'prodFailures',
    labelKey: 'quickProdFailures',
    availableIn: 'both',
    scope: { type: 'error', environment: 'PRODUCTION' },
    local: noLocal,
  },
  {
    id: 'prodBackend',
    labelKey: 'quickProdBackend',
    availableIn: 'both',
    scope: { application: 'backend', environment: 'PRODUCTION' },
    local: noLocal,
  },
  {
    id: 'lastDay',
    labelKey: 'quickLastDay',
    availableIn: 'stream',
    scope: {},
    local: now => ({ dateFrom: yesterday(now) }),
  },
  {
    id: 'noStartupNoise',
    labelKey: 'quickNoStartupNoise',
    availableIn: 'both',
    scope: {},
    local: () => ({ hideStartupNoise: true }),
  },
  {
    id: 'openIssues',
    labelKey: 'quickOpenIssues',
    availableIn: 'groups',
    scope: {},
    local: () => ({ onlyOpenIssues: true }),
  },
] as const;

export const EMPTY_SCOPE: LogsScope = {};

export const EMPTY_LOCAL_FILTERS: LogsLocalFilters = {
  search: '',
  dateFrom: '',
  dateTo: '',
  hideStartupNoise: false,
  onlyOpenIssues: false,
};

const entriesOf = <T extends object>(value: T): [keyof T, T[keyof T]][] =>
  Object.entries(value) as [keyof T, T[keyof T]][];

export const isQuickFilterActive = (
  filter: QuickFilter,
  scope: LogsScope,
  local: LogsLocalFilters,
  now: Date
): boolean => {
  const localAssertions = filter.local(now);
  const scopeMatches = entriesOf(filter.scope).every(
    ([key, value]) => scope[key] === value
  );
  const localMatches = entriesOf(localAssertions).every(
    ([key, value]) => local[key] === value
  );
  return scopeMatches && localMatches;
};

export const activeQuickFilterIds = (
  scope: LogsScope,
  local: LogsLocalFilters,
  now: Date
): QuickFilterId[] =>
  QUICK_FILTERS.filter(filter =>
    // Preset bez żadnych twierdzeń byłby „wciśnięty" zawsze — takiego nie ma,
    // ale guard trzyma tę własność, gdyby ktoś dodał pusty wpis.
    entriesOf(filter.scope).length + entriesOf(filter.local(now)).length > 0
      ? isQuickFilterActive(filter, scope, local, now)
      : false
  ).map(filter => filter.id);

export const toggleQuickFilter = (
  id: QuickFilterId,
  scope: LogsScope,
  local: LogsLocalFilters,
  now: Date
): { scope: LogsScope; local: LogsLocalFilters } => {
  const filter = QUICK_FILTERS.find(candidate => candidate.id === id);
  if (!filter) {
    return { scope, local };
  }

  const localAssertions = filter.local(now);
  const isActive = isQuickFilterActive(filter, scope, local, now);

  if (!isActive) {
    return {
      scope: { ...scope, ...filter.scope },
      local: { ...local, ...localAssertions },
    };
  }

  // Zwolnienie: kasujemy WYŁĄCZNIE wymiary ustawione przez ten preset,
  // wracając do wartości neutralnej danego pola.
  const clearedScope: LogsScope = { ...scope };
  for (const [key] of entriesOf(filter.scope)) {
    clearedScope[key] = undefined;
  }
  const clearedLocal: LogsLocalFilters = { ...local };
  for (const [key] of entriesOf(localAssertions)) {
    clearedLocal[key] = EMPTY_LOCAL_FILTERS[key] as never;
  }
  return { scope: clearedScope, local: clearedLocal };
};

/** Filters set besides the search: the N of the „Filtry N” button. */
export const countActiveFilters = (
  scope: LogsScope,
  local: LogsLocalFilters
): number =>
  Object.values(scope).filter(value => value !== undefined).length +
  entriesOf(local).filter(
    ([key, value]) => key !== 'search' && value !== EMPTY_LOCAL_FILTERS[key]
  ).length;

const isStartupNoise = (namespace: string): boolean =>
  STARTUP_NOISE_NAMESPACES.includes(namespace);

export const filterLogRows = (
  rows: readonly EventLogRecordFromDB[],
  local: LogsLocalFilters
): EventLogRecordFromDB[] => {
  const query = local.search.toLowerCase().trim();
  const fromTs = local.dateFrom
    ? new Date(`${local.dateFrom}T00:00:00`).getTime()
    : null;
  const toTs = local.dateTo
    ? new Date(`${local.dateTo}T23:59:59`).getTime()
    : null;

  return rows.filter(row => {
    if (local.hideStartupNoise && isStartupNoise(row.namespace)) {
      return false;
    }
    if (query) {
      // `client_url` niesie od 2026-08 realny endpoint (`METHOD /ścieżka`),
      // więc jest pełnoprawnym polem wyszukiwania, nie stałą.
      const haystack =
        `${row.message} ${row.namespace} ${row.client_url} ${row.user_metadata}`.toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    const ts = new Date(row.created_at).getTime();
    if (fromTs !== null && ts < fromTs) {
      return false;
    }
    if (toTs !== null && ts > toTs) {
      return false;
    }
    return true;
  });
};

export const filterGroupRows = (
  groups: readonly LogIssueGroup[],
  local: LogsLocalFilters
): LogIssueGroup[] => {
  const query = local.search.toLowerCase().trim();

  return groups.filter(group => {
    if (local.hideStartupNoise && isStartupNoise(group.namespace)) {
      return false;
    }
    if (
      local.onlyOpenIssues &&
      SETTLED_LOG_ISSUE_STATUSES.includes(group.status)
    ) {
      return false;
    }
    if (query) {
      const haystack =
        `${group.sample_message} ${group.namespace}`.toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    return true;
  });
};

export type LogsUrlState = {
  view: LogsViewMode;
  scope: LogsScope;
  local: LogsLocalFilters;
  logId: string | null;
  /**
   * The list behind the menu badge `log_issues_open`: the server fixes the
   * scope (production, errors, last 7 days, new or regressed) and ignores
   * every other filter, so the page shows one scope chip instead of filters.
   */
  attention: boolean;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const LOG_ID = /^\d+$/;

// Parameter names are the kernel URL contract (ADMIN_LOGS_QUERY): the menu
// badge and admin alert mails link into this page with the same names.
const Q = ADMIN_LOGS_QUERY;

const firstQueryValue = (
  value: string | string[] | undefined
): string | undefined => (Array.isArray(value) ? value[0] : value);

export const parseLogsQuery = (
  query: Record<string, string | string[] | undefined>
): LogsUrlState => {
  const view = firstQueryValue(query[Q.view]);
  const type = firstQueryValue(query[Q.type]);
  const application = firstQueryValue(query[Q.application]);
  const environment = firstQueryValue(query[Q.environment]);
  const from = firstQueryValue(query[Q.dateFrom]);
  const to = firstQueryValue(query[Q.dateTo]);
  const log = firstQueryValue(query[Q.logId]);
  const attention = firstQueryValue(query[Q.attention]) === ADMIN_LOGS_FLAG_ON;

  return {
    // The attention list is a list of groups, whatever `view` says.
    view: attention || view === ADMIN_LOGS_VIEW_GROUPS ? 'groups' : 'stream',
    scope: {
      ...(isSendLogType(type) && { type }),
      ...(isLogApplication(application) && { application }),
      ...(isLogEnvironment(environment) && { environment }),
    },
    local: {
      search: firstQueryValue(query[Q.search]) ?? '',
      dateFrom: from !== undefined && ISO_DAY.test(from) ? from : '',
      dateTo: to !== undefined && ISO_DAY.test(to) ? to : '',
      hideStartupNoise:
        firstQueryValue(query[Q.hideStartupNoise]) === ADMIN_LOGS_FLAG_ON,
      onlyOpenIssues:
        firstQueryValue(query[Q.onlyOpenIssues]) === ADMIN_LOGS_FLAG_ON,
    },
    logId: log !== undefined && LOG_ID.test(log) ? log : null,
    attention,
  };
};

export const buildLogsQuery = (state: LogsUrlState): Record<string, string> => {
  const out: Record<string, string> = {};
  if (state.view === 'groups' || state.attention) {
    out[Q.view] = ADMIN_LOGS_VIEW_GROUPS;
  }
  if (state.attention) {
    out[Q.attention] = ADMIN_LOGS_FLAG_ON;
  }
  if (state.scope.type !== undefined) {
    out[Q.type] = state.scope.type;
  }
  if (state.scope.application !== undefined) {
    out[Q.application] = state.scope.application;
  }
  if (state.scope.environment !== undefined) {
    out[Q.environment] = state.scope.environment;
  }
  if (state.local.search.length > 0) {
    out[Q.search] = state.local.search;
  }
  if (state.local.dateFrom.length > 0) {
    out[Q.dateFrom] = state.local.dateFrom;
  }
  if (state.local.dateTo.length > 0) {
    out[Q.dateTo] = state.local.dateTo;
  }
  if (state.local.hideStartupNoise) {
    out[Q.hideStartupNoise] = ADMIN_LOGS_FLAG_ON;
  }
  if (state.local.onlyOpenIssues) {
    out[Q.onlyOpenIssues] = ADMIN_LOGS_FLAG_ON;
  }
  if (state.logId !== null) {
    out[Q.logId] = state.logId;
  }
  return out;
};

export const ADMIN_LOGS_URL_CODEC = {
  keys: Object.values(ADMIN_LOGS_QUERY),
  parse: parseLogsQuery,
  build: buildLogsQuery,
};
