/**
 * ConnectionCheckPage: four client-side checks outside the authenticated app (PublicLayout).
 * Frontend is up because the page rendered. Backend fetches admin health; 401/403 still
 * means the server answered (health-public is server-to-server and has no CORS).
 * Session calls /session/get-current (200 active, 401 anonymous). Runtime checks theme and locale.
 * DECISION: a logged-out visitor is normal (footer "Status"), so anonymous and 401/403
 * report ok. Treating them as failures would make the page always warn.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/router';
import {
  CheckRowMolecule,
  CHECK_ORDER,
  overallStatus,
  type CheckState,
  type ChecksRecord,
} from './ConnectionCheckPage.parts.molecule';
import {
  ROUTES_API,
  ROUTES_FRONT,
} from '@kernel/domain/routing/routing.config';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { SystemNoticeOrganism } from '../../components/SystemNotice/SystemNotice.organism';
import notice from '../../components/SystemNotice/SystemNotice.module.css';
import { ENV_VARS } from '../../../application/environment/environment.config';
import { buildBackendBaseUrl } from '../../../application/environment/backend-url';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { getFromClientStorage } from '../../../application/client-device-storage/clientStorage.possibilities.api';
import styles from './ConnectionCheckPage.module.css';
import { DEFAULT_THEME } from '../../styles/ThemeContext.composition';

const CHECK_TIMEOUT_MS = 10_000;

/* ─── Types and the check row: ConnectionCheckPage.parts.molecule.tsx ─── */

/* ─── Main page component ─── */

export function ConnectionCheckPageComposition() {
  const t = useTranslations('pages.connectionCheck');
  const router = useRouter();

  const [checks, setChecks] = useState<ChecksRecord>({
    frontend: { status: 'checking' },
    backend: { status: 'checking' },
    session: { status: 'checking' },
    runtime: { status: 'checking' },
  });
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);

  const inflight = useRef(false);

  const runChecks = useCallback(async () => {
    if (inflight.current) {
      return;
    }
    inflight.current = true;

    setChecks({
      frontend: { status: 'checking' },
      backend: { status: 'checking' },
      session: { status: 'checking' },
      runtime: { status: 'checking' },
    });

    /* 1. Frontend — by definition OK (we're rendering). */
    const frontendState: CheckState = { status: 'ok' };

    // Empty base = backend domain not configured (buildBackendBaseUrl SSOT);
    // treat as unreachable so we never fetch a relative URL against the
    // frontend origin and mis-report it as a healthy backend.
    const backendBaseUrl = buildBackendBaseUrl();

    /* 2. Backend — fetch public health endpoint. */
    let backendState: CheckState = { status: 'fail' };
    if (backendBaseUrl === '') {
      backendState = {
        status: 'fail',
        detail: t('checks.backend.failNetwork'),
      };
    } else {
      try {
        const url = `${backendBaseUrl}${ROUTES_API.ADMIN_HEALTH}`;
        const t0 = performance.now();
        const res = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        });
        const ms = Math.round(performance.now() - t0);
        if (res.ok) {
          backendState = {
            status: 'ok',
            detail: t('checks.backend.okMs', { ms }),
          };
        } else if (res.status === 401 || res.status === 403) {
          // DECISION: 401/403 means the backend is alive (see file header).
          backendState = { status: 'ok' };
        } else {
          backendState = {
            status: 'warn',
            detail: t('checks.backend.warnHttp', {
              status: String(res.status),
            }),
          };
        }
      } catch (_err) {
        backendState = {
          status: 'fail',
          detail: t('checks.backend.failNetwork'),
        };
      }
    }

    /* 3. Session — calls SESSION_GET_CURRENT. 401 is OK (anon).
     *    DECISION: anon === ok (see file header). */
    let sessionState: CheckState = { status: 'fail' };
    if (backendBaseUrl === '') {
      sessionState = {
        status: 'fail',
        detail: t('checks.session.failNetwork'),
      };
    } else {
      try {
        const url = `${backendBaseUrl}${ROUTES_API.SESSION_GET_CURRENT}`;
        // The endpoint returns 200 SUCCESS to everyone (anonymous means data is absent).
        // Decide by the PRESENCE of data, not by res.ok (an anonymous visitor saw
        // "zalogowana"). A token with a Bearer prefix mirrors http.utils.
        const token = getFromClientStorage({
          key: CUSTOM_HEADERS.authorization,
        });
        const res = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
          headers:
            token !== null && token !== ''
              ? {
                  [CUSTOM_HEADERS.authorization]: token.startsWith('Bearer ')
                    ? token
                    : `Bearer ${token}`,
                }
              : {},
        });
        if (res.ok) {
          const parsed = (await res.json().catch(() => null)) as {
            data?: unknown;
          } | null;
          sessionState =
            parsed?.data != null
              ? { status: 'ok', detail: t('checks.session.okActive') }
              : { status: 'ok', detail: t('checks.session.okAnon') };
        } else if (res.status === 401 || res.status === 403) {
          sessionState = { status: 'ok', detail: t('checks.session.okAnon') };
        } else {
          sessionState = {
            status: 'warn',
            detail: t('checks.session.warnHttp', {
              status: String(res.status),
            }),
          };
        }
      } catch (_err) {
        sessionState = {
          status: 'fail',
          detail: t('checks.session.failNetwork'),
        };
      }
    }

    /* 4. Runtime — read DOM data-theme / data-mode / locale. */
    let runtimeState: CheckState = { status: 'ok' };
    try {
      const root = document.documentElement;
      const mode = root.getAttribute('data-mode') ?? 'light';
      const theme = root.getAttribute('data-theme') ?? DEFAULT_THEME;
      const locale = router.locale ?? root.lang ?? 'pl';
      runtimeState = {
        status: 'ok',
        detail: t('checks.runtime.okDetail', {
          mode,
          theme,
          locale: locale.toUpperCase(),
        }),
      };
    } catch (_err) {
      runtimeState = { status: 'warn', detail: t('checks.runtime.warnNoDom') };
    }

    setChecks({
      frontend: frontendState,
      backend: backendState,
      session: sessionState,
      runtime: runtimeState,
    });
    setLastRunAt(new Date());
    inflight.current = false;
  }, [router.locale, t]);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  const overall = overallStatus(checks);
  const overallHeading = t(`overall.${overall}`);
  const timestampLabel = !lastRunAt
    ? t('checksTimestampPending')
    : t('checksTimestampDone', {
        time: lastRunAt.toLocaleTimeString(router.locale ?? 'pl', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      });

  const versionTag = ENV_VARS.NEXT_PUBLIC_NODE_ENV_MANUAL.toLowerCase();

  return (
    <PublicLayoutComposition>
      <div className={notice.page}>
        {/* The one sentence of this page IS the result, announced when it
            changes; the action that matters here is the re-check. */}
        <SystemNoticeOrganism
          titleId='conn-title'
          title={t('heroTitle')}
          body={
            <p className={styles.overall} role='status' aria-live='polite'>
              {overallHeading}
            </p>
          }
          actions={
            <>
              <ButtonAtom
                variant='primary'
                size='lg'
                onClick={() => {
                  void runChecks();
                }}
                disabled={overall === 'checking'}
                aria-busy={overall === 'checking'}>
                {t('refresh')}
              </ButtonAtom>
              <LinkButtonAtom
                href={ROUTES_FRONT.HOME}
                variant='outlined'
                size='lg'>
                {t('backHome')}
              </LinkButtonAtom>
            </>
          }
        />

        {/* ─── Checks list: read-only, so no leading icons and no arrows ─── */}
        <section className={styles.checks} aria-labelledby='conn-checks'>
          <h2 id='conn-checks' className={styles.checksHeading}>
            {t('checksHeading')}
          </h2>
          <ol className={styles.checksList}>
            {CHECK_ORDER.map(key => (
              <CheckRowMolecule
                key={key}
                checkKey={key}
                state={checks[key]}
                t={t}
              />
            ))}
          </ol>
          {/* Each piece is unbreakable; a narrow screen moves a whole piece
              to the next line instead of breaking inside it. */}
          <p className={styles.diagnosticLine}>
            <span className={styles.diagnosticItem} aria-live='polite'>
              {timestampLabel}
            </span>
            <span className={styles.diagnosticItem}>
              {t('diagnostic.version', { value: versionTag })}
            </span>
            <span className={styles.diagnosticItem}>
              {t('diagnostic.locale', {
                value: (router.locale ?? 'pl').toUpperCase(),
              })}
            </span>
          </p>
        </section>
      </div>
    </PublicLayoutComposition>
  );
}
