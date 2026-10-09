// UI/features/sessions/ClientSessionsPage.parts.organism.tsx
// The session row (one look for open and finished sessions) and the month
// group of the history. Section-level blocks live in
// ./ClientSessionsPage.blocks.organism.tsx, pure formatters in
// ./ClientSessionsPage.formatters.ts.

import type { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';
import {
  isActiveSession,
  isTerminalSession,
} from '@kernel/domain/session-container/session-container.types';
import { NavRowListMolecule } from '../../components/NavRow/NavRow.molecule';
import { SessionRowMolecule } from '../shared/sessions/SessionRow.molecule';
import {
  formatAbsoluteDate,
  formatDaysRemainingAfterStatus,
  getLifecycleColor,
  getLifecycleLabel,
  monthLabelParts,
  resolveSessionDisplayName,
  sessionTimestamp,
  shouldPulseStatus,
} from './ClientSessionsPage.formatters';
import styles from './ClientSessionsPage.module.css';

type TSessionsPage = ReturnType<typeof useTranslations<'pages.sessions'>>;

/** The date that belongs to the status: when an open, shared session expires,
 *  or the day a finished one ended. A draft has neither. */
function resolveStatusDate(
  session: SessionContainerDTO,
  locale: string,
  t: TSessionsPage
): string | null {
  if (isTerminalSession(session.lifecycleState)) {
    const date = formatAbsoluteDate(sessionTimestamp(session), locale);
    return date.length > 0 ? date : null;
  }
  if (isActiveSession(session.lifecycleState) && session.expiresAt !== null) {
    return formatDaysRemainingAfterStatus(session.expiresAt, t);
  }
  return null;
}

/* ============================================================
 * SessionRow — the whole row is the link to the session
 *
 * DECISION (nie usuwaj tego komentarza):
 * The row is SessionRowMolecule (features/shared/sessions), the SAME molecule
 * the stylist's list renders, built on NavRowMolecule (owner vote
 * `s126-wiersze`, 2026-10-09). The client's row has no avatar (it is her own
 * list, named by session) and its status comes from the lifecycle helpers in
 * ./ClientSessionsPage.formatters, which map all six states; the stylist's
 * resolver has different rules and copy, so the two are not merged.
 * ============================================================ */

export function SessionRowOrganism({
  session,
  locale,
  t,
  disambiguationTime,
  stylistName,
}: {
  session: SessionContainerDTO;
  locale: string;
  t: TSessionsPage;
  disambiguationTime?: string | undefined;
  /** The connected stylist this session is for; undefined when unknown. */
  stylistName?: string | undefined;
}) {
  // A finished row shows its date next to the status, so its unnamed fallback
  // stays plain („Sesja”); an open unnamed session is named by its date.
  // disambiguationTime (when set) keeps two unnamed sessions of one day apart
  // (owner vote S27 #3, variant A).
  const { label: displayName } = resolveSessionDisplayName(
    session,
    locale,
    t,
    !isTerminalSession(session.lifecycleState),
    disambiguationTime
  );
  const statusDate = resolveStatusDate(session, locale, t);

  return (
    <SessionRowMolecule
      href={buildRoute(ROUTES_FRONT.CLIENT_SESSION_DETAIL, {
        sessionId: session.id,
      })}
      label={displayName}
      photoCountLabel={t('photoCount', { count: session.photoCount })}
      status={{
        color: getLifecycleColor(session.lifecycleState),
        label: getLifecycleLabel(session.lifecycleState, t),
        pulse: shouldPulseStatus(session.lifecycleState),
      }}
      when={statusDate}
      // An open, shared session with time left: the time goes into the pill
      // („Udostępniona jeszcze 6 dni”).
      whenContinuesStatus={
        isActiveSession(session.lifecycleState) &&
        session.expiresAt !== null &&
        new Date(session.expiresAt).getTime() > Date.now()
      }
      forStylist={stylistName ?? ''}
    />
  );
}

/* ============================================================
 * SessionMonthGroup — sticky month header + one list of that month's rows
 * ============================================================ */

export function SessionMonthGroupOrganism({
  monthIso,
  sessions,
  locale,
  t,
  disambiguationTimes,
  stylistNames,
}: {
  monthIso: string;
  sessions: SessionContainerDTO[];
  locale: string;
  t: TSessionsPage;
  disambiguationTimes: ReadonlyMap<string, string>;
  stylistNames: ReadonlyMap<string, string>;
}) {
  const labelParts = monthLabelParts(monthIso, locale);
  const monthLabel =
    labelParts !== null ? `${labelParts.month} ${labelParts.year}` : null;
  return (
    <div className={styles.month}>
      <div className={styles.monthHeader}>
        <h3 className={styles.monthLabel}>{monthLabel}</h3>
        <span className={styles.monthCount}>
          {t('monthCount', { count: sessions.length })}
        </span>
      </div>
      <NavRowListMolecule
        {...(monthLabel !== null ? { ariaLabel: monthLabel } : {})}>
        {sessions.map(s => (
          <SessionRowOrganism
            key={s.id}
            session={s}
            locale={locale}
            t={t}
            disambiguationTime={disambiguationTimes.get(s.id)}
            stylistName={
              s.stylistAccountId !== null
                ? stylistNames.get(s.stylistAccountId)
                : undefined
            }
          />
        ))}
      </NavRowListMolecule>
    </div>
  );
}
