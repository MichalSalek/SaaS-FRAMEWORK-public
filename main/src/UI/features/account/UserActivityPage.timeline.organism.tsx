// UI/features/account/UserActivityPage.timeline.organism.tsx
// The activity log as a readable list: one quiet label per day, one white box
// per day, one row per event (icon, title, time).
//
// DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
// the log used to be an „oś czasu” of framed cards on a rail, each with a
// coloured category badge, and it showed 30 to 60 identical „Zalogowano” rows.
// Now: (1) a row is a plain list row (static content: no frame, no hover, no
// arrow); (2) the badge is gone, it repeated the filter above the list;
// (3) the same event repeated in a row within one day is ONE row with a count
// and the time of the first occurrence. Rows are never merged across days or
// across different events, so the order of what happened stays readable.

import type { EVENTS_ALL_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import type { UserActivityLogRecord } from '@kernel/models/event-log/event_log.dto';
import { formatDate } from '../../../application/date/date.utils';
import { resolveEventVisual, type TimelineTx } from './UserActivityPage.events';
import styles from './UserActivityPage.module.css';

/* ============================================================
 *  Day grouping + runs of the same event
 * ============================================================ */

/** Consecutive occurrences of one event within one day (newest first). */
export interface EventRun {
  /** event_log_id of the newest occurrence. */
  key: string;
  event: EVENTS_ALL_TYPE;
  latest: Date;
  earliest: Date;
  count: number;
}

export interface DayGroup {
  /** ISO 8601 yyyy-mm-dd in user's local timezone. */
  dayKey: string;
  /** Date object pinned to local midnight for that day. */
  dayDate: Date;
  runs: EventRun[];
}

function toDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Groups entries by local day and folds consecutive repeats of one event.
 * The caller passes an already-time-sorted list (newest first); the order
 * received is preserved.
 */
export function groupByDay(
  entries: readonly UserActivityLogRecord[]
): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const entry of entries) {
    const raw = entry.created_at;
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) {
      continue;
    }
    const key = toDayKey(d);
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        dayKey: key,
        dayDate: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        runs: [],
      };
      groups.set(key, group);
    }
    const last = group.runs.at(-1);
    if (last !== undefined && last.event === entry.event) {
      last.count += 1;
      last.earliest = d;
    } else {
      group.runs.push({
        key: String(entry.event_log_id),
        event: entry.event,
        latest: d,
        earliest: d,
        count: 1,
      });
    }
  }
  return [...groups.values()];
}

type RelativeDay = 'today' | 'yesterday' | null;

function relativeDay(dayDate: Date, now: Date = new Date()): RelativeDay {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round(
    (today.getTime() - dayDate.getTime()) / 86_400_000
  );
  if (diffDays === 0) {
    return 'today';
  }
  return diffDays === 1 ? 'yesterday' : null;
}

// Locale-keyed cache — mirrors application/date/date.utils.ts (Intl.DateTimeFormat
// is expensive; max 1 instance per locale, the list renders many rows).
const TIME_FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatTimeOfDay(d: Date, locale: string): string {
  try {
    let fmt = TIME_FMT_CACHE.get(locale);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
      });
      TIME_FMT_CACHE.set(locale, fmt);
    }
    return fmt.format(d);
  } catch {
    return '';
  }
}

// DECISION (nie usuwaj tego komentarza):
// „Payload chips" (poprzednio czytające EventLog.event_payload) są PARKED. User-side
// endpoint „Aktywność" celowo NIE wysyła event_payload (PII-minimization — patrz
// UserActivityLogRecord w event-log/event_log.dto), więc te chipsy NIGDY się nie
// renderowały (event_payload zawsze undefined → pusta lista → blok JSX martwy).
// Usunięto martwy kod, by kontrakt typu był uczciwy. Rewitalizacja = decyzja
// produktowo-prywatnościowa właściciela: dopisać `event_payload` do projekcji DTO
// + SELECT w getEventLogsByUser_IO, potem przywrócić helper + blok chipów.

/* ============================================================
 *  List
 * ============================================================ */

export interface ActivityTimelineLabels {
  /** „Dzisiaj, 8 paź 2026” / „Wczoraj, 7 paź 2026”; other days = the date. */
  day: (relative: 'today' | 'yesterday', date: string) => string;
  /** Meta of a folded run: „12 razy, pierwszy raz o 08:10”. */
  repeat: (count: number, firstTime: string) => string;
}

interface TimelineProps {
  groups: readonly DayGroup[];
  tx: TimelineTx;
  labels: ActivityTimelineLabels;
  locale: string;
}

export function ActivityTimelineOrganism({
  groups,
  tx,
  labels,
  locale,
}: TimelineProps) {
  return (
    <div className={styles.timeline}>
      {groups.map(group => {
        // One date format for the whole account area: „8 paź 2026”.
        const date = formatDate(group.dayDate, locale);
        const relative = relativeDay(group.dayDate);
        const heading = relative === null ? date : labels.day(relative, date);
        return (
          <section
            key={group.dayKey}
            className={styles.dayGroup}
            aria-label={heading}>
            <h2 className={styles.dayHeader}>{heading}</h2>
            <ul className={styles.dayList}>
              {group.runs.map(run => {
                const visual = resolveEventVisual(run.event, tx);
                const time = formatTimeOfDay(run.latest, locale);
                return (
                  <li key={run.key} className={styles.eventRow}>
                    <span
                      className={`${styles.eventIcon} ${visual.colorClass}`}
                      aria-hidden='true'>
                      {visual.icon}
                    </span>
                    <span className={styles.eventBody}>
                      <span className={styles.eventTitle}>{visual.title}</span>
                      {run.count > 1 && (
                        <span className={styles.eventMeta}>
                          {labels.repeat(
                            run.count,
                            formatTimeOfDay(run.earliest, locale)
                          )}
                        </span>
                      )}
                    </span>
                    {time !== '' && (
                      <time
                        className={styles.eventTime}
                        dateTime={run.latest.toISOString()}>
                        {time}
                      </time>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
