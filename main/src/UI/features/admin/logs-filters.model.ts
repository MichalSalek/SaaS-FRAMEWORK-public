// UI/features/admin/logs-filters.model.ts
// Pure logic of the log panel filters: preset definitions, resolving which preset is "pressed", and
// client-side filtering.
//
// DECISION: a preset keeps NO boolean state of its own. It is "pressed" if and only if its WHOLE
// set of claims matches the current filters, so changing a select by hand unpresses the preset
// instead of leaving a lit button that describes a state that is gone. Releasing a preset clears
// only what it set; other dimensions stay untouched.

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
  /** Claims about the local filters; `now` keeps the function pure. */
  local: (now: Date) => Partial<LogsLocalFilters>;
};

const noLocal = (): Partial<LogsLocalFilters> => ({});

/** `YYYY-MM-DD` in local time — the format accepted by `<input type="date">`. */
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

// Presets describe SITUATIONS, not single dimensions; those have their own selects, and duplicating
// them with a button would only be a second way to do the same thing.
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
    // A preset with no claims would be "pressed" always; there is none, but this guard keeps the
    // property in case someone adds an empty entry.
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

  // Release: we clear ONLY the dimensions set by this preset, returning each field to its neutral
  // value.
  const clearedScope: LogsScope = { ...scope };
  for (const [key] of entriesOf(filter.scope)) {
    delete clearedScope[key];
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
      // `client_url` has carried a real endpoint (`METHOD /path`) since 2026-08, so it is a full search
      // field, not a constant.
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
