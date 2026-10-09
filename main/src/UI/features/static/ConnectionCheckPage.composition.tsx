/**
 * ConnectionCheckPage — utility diagnostic page.
 *
 * Diagnostic surface that runs four runtime health checks and renders
 * results with semantic status indicators. Lives outside the
 * authenticated app, so it uses `PublicLayout` for header/footer parity.
 *
 * Checks performed (all client-side, no auth required for the page itself):
 *   1. frontend  — the page rendered, so by definition Next.js is up.
 *   2. backend   — fetches the admin health endpoint; a 401/403 still proves the
 *                  backend is reachable (auth answered), so it counts as ok
 *                  (health-public is S2S / no-CORS, unusable from the browser).
 *   3. session   — calls /session/get-current; 200 = active session,
 *                  401 = anon (still a valid state, not a failure).
 *   4. runtime   — verifies dark/light theme + locale stored in DOM.
 *
 * DECISION (nie usuwaj tego komentarza):
 * We INTENTIONALLY report the "anon session" branch as `ok`, not `warn`.
 * Visiting /connection-check while logged out is a legitimate scenario
 * (support copy-paste link, debugging) and a 401 from the session
 * endpoint there means the auth layer answered correctly. Flipping the
 * row to red would teach users to ignore the page.
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

// Bez limitu czasu zawieszone połączenie (dokładnie ten przypadek, który ta
// strona ma diagnozować) trzymało „Sprawdzam…" w nieskończoność, a przycisk
// „Odśwież" był wyłączony. Po limicie check kończy się jak brak sieci.
const CHECK_TIMEOUT_MS = 10_000;

/* ─── Types + wiersz checka: ConnectionCheckPage.parts.molecule.tsx (S76) ─── */

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
          // DECISION (nie usuwaj tego komentarza):
          // 401/403 z health endpointu == backend ŻYJE (warstwa auth odpowiedziała
          // poprawnie). Dla anonimowego gościa (główny odbiorca tej strony przez
          // footer "Status") admin/health zawsze zwraca 401 — mapowanie tego na
          // 'warn' kazało stronie statusu zawsze krzyczeć "drobny problem" mimo że
          // wszystko działa. Traktujemy reachable-with-auth jako 'ok', spójnie z
          // gałęzią session poniżej.
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
        // S76: endpoint daje 200 SUCCESS każdemu (anon → data:undefined) —
        // rozstrzygamy po OBECNOŚCI data, nie po res.ok (anon widział
        // "zalogowana"). Token z Bearer-prefiksem = lustro http.utils.
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
