// STATUS/MONITORING SETUP:
// - Better Stack is the operational monitor SSOT (docs/RUNBOOK.md).
// - /api/health/ = recurring frontend-only liveness.
// - /api/health/dependencies/ = secret-gated, on-demand exact public bootstrap
//   smoke (feature-flags + announcements + runtime-config). It is deliberately
//   NOT a frequent heartbeat because it exercises real DB-backed routes.
// - NEXT_PUBLIC_OPENSTATUS_PAGE_ID remains an optional legacy external status
//   link until the public /status integration is migrated separately.
//
// Future (Phase 2): OPENSTATUS_API_TOKEN (server-side) for posting incidents programmatically.
// Deferred — Phase 1 uses openstatus.dev dashboard for manual incident management.

import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useTranslations } from 'next-intl';
import {
  CheckCircleIcon,
  WarningIcon,
  XCircleIcon,
  ClockIcon,
  ArrowSquareOutIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import styles from './StatusPage.module.css';

/* ─── Types ─── */

type ServiceStatus = 'operational' | 'degraded' | 'down';

type ServiceKey = 'app' | 'api' | 'db';

interface ServiceItem {
  key: ServiceKey;
  status: ServiceStatus;
}

interface HealthState {
  database: 'up' | 'down';
  api: 'up' | 'down';
}

interface StatusPageProps {
  /** Health probe result from SSR. `null` = probe failed (degraded/unknown). */
  health: HealthState | null;
  /** A ready, formatted label of the probe time (formatting HAPPENS
   * in getServerSideProps: an identical string in SSR and hydration). The component
   * used to format the ISO through Intl in render: Node-ICU vs browser-ICU
   * + a date change at midnight gave a hydration text mismatch. */
  lastCheckedAtLabel: string;
}

/* ─── Helpers ─── */

function upDownToStatus(raw: 'up' | 'down'): ServiceStatus {
  return raw === 'up' ? 'operational' : 'down';
}

/**
 * Maps the SSR health probe to the three rendered service rows. The frontend
 * (`app`) is always operational here — this very page rendered, so the app is up.
 * `api`/`db` come from the probe; when `health` is null (probe failed, backend
 * unreachable) they degrade to 'degraded' (unknown), NOT a hard 'down' — a failed
 * probe is not proof of a backend outage, only that the status page could not read it.
 */
function deriveServices(health: HealthState | null): ServiceItem[] {
  if (health === null) {
    return [
      { key: 'app', status: 'operational' },
      { key: 'api', status: 'degraded' },
      { key: 'db', status: 'degraded' },
    ];
  }
  return [
    { key: 'app', status: 'operational' },
    { key: 'api', status: upDownToStatus(health.api) },
    { key: 'db', status: upDownToStatus(health.database) },
  ];
}

function overallStatus(services: ServiceItem[]): ServiceStatus {
  if (services.some(s => s.status === 'down')) {
    return 'down';
  }
  if (services.some(s => s.status === 'degraded')) {
    return 'degraded';
  }
  return 'operational';
}

/* ─── Sub-components ─── */

interface StatusIconProps {
  status: ServiceStatus;
  size?: number;
}

function StatusIcon({ status, size = 20 }: StatusIconProps) {
  if (status === 'operational') {
    return (
      <CheckCircleIcon
        size={size}
        weight='fill'
        className={styles.iconOperational}
        aria-hidden='true'
      />
    );
  }
  if (status === 'degraded') {
    return (
      <WarningIcon
        size={size}
        weight='fill'
        className={styles.iconDegraded}
        aria-hidden='true'
      />
    );
  }
  return (
    <XCircleIcon
      size={size}
      weight='fill'
      className={styles.iconDown}
      aria-hidden='true'
    />
  );
}

/* ─── StatusPage ─── */

/**
 * Live service status page.
 *
 * DECISION: see main/src/pages/status.tsx (SSR health probe, no CORS). This component
 * does no client-side fetching; `health === null` (failed probe) renders degraded
 * (unknown), never a hard outage. openstatus.dev is optional, shown only when
 * NEXT_PUBLIC_OPENSTATUS_PAGE_ID is set.
 */
function StatusPageInner({ health, lastCheckedAtLabel }: StatusPageProps) {
  const t = useTranslations('static.status');

  const services = deriveServices(health);
  const overall = overallStatus(services);

  // openstatus.dev external page link — shown only when PAGE_ID env is set
  const openstatusPageId =
    typeof process.env.NEXT_PUBLIC_OPENSTATUS_PAGE_ID === 'string' &&
    process.env.NEXT_PUBLIC_OPENSTATUS_PAGE_ID.length > 0
      ? process.env.NEXT_PUBLIC_OPENSTATUS_PAGE_ID
      : null;
  const openstatusUrl = openstatusPageId
    ? `https://${openstatusPageId}.openstatus.dev`
    : null;

  return (
    <div className={styles.page}>
      {/* ─── Overall status banner ─── */}
      <section
        className={styles.overallBanner}
        data-status={overall}
        role='status'
        aria-live='polite'
        aria-label={t('overallAriaLabel', {
          label: t(`statusLabels.${overall}`),
        })}>
        <div className={styles.overallInner}>
          {/* Status icon + heading row */}
          <div className={styles.statusRow}>
            <StatusIcon status={overall} size={28} />
            <h1 className={styles.overallHeading}>
              {t(`overallHeadings.${overall}`)}
            </h1>
          </div>

          <p className={styles.overallSub}>
            {`${t('lastUpdated')} ${lastCheckedAtLabel}`}
          </p>
        </div>
      </section>

      {/* ─── Services list ─── */}
      <section className={styles.servicesSection}>
        <div className={styles.servicesInner}>
          <h2 className={styles.sectionHeading}>{t('componentsHeading')}</h2>

          <ul className={styles.servicesList}>
            {services.map(service => {
              const statusLabel = t(`statusLabels.${service.status}`);
              return (
                <li
                  key={service.key}
                  className={styles.serviceRow}
                  aria-label={`${t(`services.${service.key}.name`)}: ${statusLabel}`}>
                  <div className={styles.serviceInfo}>
                    <span className={styles.serviceName}>
                      {t(`services.${service.key}.name`)}
                    </span>
                    <span className={styles.serviceDescription}>
                      {t(`services.${service.key}.description`)}
                    </span>
                  </div>
                  <div
                    className={styles.serviceBadge}
                    data-status={service.status}>
                    <StatusIcon status={service.status} size={16} />
                    <span className={styles.statusLabel}>{statusLabel}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* ─── History placeholder ─── */}
      <section className={styles.historySection}>
        <div className={styles.historyInner}>
          <div className={styles.historyHeader}>
            <ClockIcon size={20} weight='regular' aria-hidden='true' />
            <h2 className={styles.sectionHeading}>{t('incidentsHeading')}</h2>
          </div>
          <p className={styles.historyEmpty}>{t('noIncidents')}</p>

          {/* External status page link (openstatus.dev) — rendered only when ENV is set */}
          {openstatusUrl && (
            <a
              href={openstatusUrl}
              target='_blank'
              rel='noopener noreferrer'
              className={styles.openstatusLink}>
              {t('openstatusLinkLabel')}
              <ArrowSquareOutIcon size={14} aria-hidden='true' />
            </a>
          )}
        </div>
      </section>

      {/* ─── Help CTA ─── */}
      <section className={styles.helpSection}>
        <p className={styles.helpText}>
          {t.rich('helpText', {
            reportLink: chunks => (
              <AppParagraphLinkAtom
                href={ROUTES_FRONT.CONTACT}
                className={styles.helpLink}>
                {chunks}
              </AppParagraphLinkAtom>
            ),
          })}
        </p>
        {/* The second half of the question "is it you or me": this page answers
         * for the state of OUR services, /connection-check examines the user's side
         * (frontend, backend, session, browser settings). This diagnostic used to
         * have no entry from the product: it existed, was maintained and nobody could
         * reach it except by typing the address. */}
        <p className={styles.helpText}>
          {t.rich('selfCheckText', {
            checkLink: chunks => (
              <AppParagraphLinkAtom
                href={ROUTES_FRONT.CONNECTION_CHECK}
                className={styles.helpLink}>
                {chunks}
              </AppParagraphLinkAtom>
            ),
          })}
        </p>
      </section>
    </div>
  );
}

export function StatusPageComposition(props: StatusPageProps) {
  return (
    <PublicLayoutComposition>
      <StatusPageInner {...props} />
    </PublicLayoutComposition>
  );
}
