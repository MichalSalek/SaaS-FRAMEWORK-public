/**
 * Cloudflare Turnstile widget (managed mode): anti-spam for public forms.
 *
 * Rules:
 *  - Renders ONLY when `isTurnstileEnabled()` (key by presence, see
 *    turnstile.config.ts); the parent gates nothing.
 *  - The CF script loads LAZILY, only after the user's first TRUSTED
 *    interaction (trusted-interaction SSOT): no LCP cost for ordinary traffic
 *    and no challenge exposure for crawlers without input events.
 *  - The token is SINGLE-USE: after every submit attempt the parent bumps
 *    `resetNonce`, which resets the widget and invalidates the old token.
 *  - CSP: `challenges.cloudflare.com` in script-src + frame-src (proxy.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../Button/Button.atom';
import { onTrustedInteraction } from '../../shared/interaction/trusted-interaction';
import {
  TURNSTILE_CONFIG,
  isTurnstileEnabled,
} from '../../../application/security/turnstile.config';
import styles from './TurnstileWidget.module.css';
import { createTurnstileFailureReporter } from '../../../application/security/turnstile-diagnostics';

type TurnstileRenderParams = {
  sitekey: string;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': (errorCode: string) => boolean;
  'before-interactive-callback': () => void;
  'timeout-callback': () => void;
  'unsupported-callback': () => void;
  appearance: 'interaction-only' | 'always';
  theme: 'auto';
};

type TurnstileApi = {
  render: (el: HTMLElement, params: TurnstileRenderParams) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const script = document.createElement('script');
    const timeout = window.setTimeout(
      () => reject(new Error('turnstile script load timed out')),
      10_000
    );
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.turnstile) {
        resolve(window.turnstile);
      } else {
        reject(new Error('turnstile api missing after script load'));
      }
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('turnstile script failed to load'));
    };
    document.head.appendChild(script);
  }).catch((err: unknown) => {
    scriptPromise = null;
    document.head.querySelector(`script[src="${SCRIPT_SRC}"]`)?.remove();
    throw err;
  });
  return scriptPromise;
}

export function TurnstileWidgetAtom({
  onToken,
  resetNonce,
}: {
  /** Fresh token after the challenge is solved; null when it expired or was reset. */
  onToken: (token: string | null) => void;
  /** Bump after every submit attempt: the CF token is single-use. */
  resetNonce: number;
}) {
  const t = useTranslations('buttons');
  const [failed, setFailed] = useState(false);
  const [solved, setSolved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [reportFailure] = useState(createTurnstileFailureReporter);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const verificationAttemptRef = useRef(0);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!isTurnstileEnabled()) {
      return;
    }
    let cancelled = false;
    const invalidateToken = (showError = false) => {
      if (cancelled) {
        return;
      }
      setSolved(false);
      setFailed(showError);
      onTokenRef.current(null);
    };
    const unsubscribe = onTrustedInteraction(() => {
      verificationAttemptRef.current += 1;
      void loadTurnstile()
        .then(api => {
          if (cancelled || widgetIdRef.current !== null || !hostRef.current) {
            return;
          }
          widgetIdRef.current = api.render(hostRef.current, {
            sitekey: TURNSTILE_CONFIG.SITE_KEY,
            callback: token => {
              if (cancelled) {
                return;
              }
              setFailed(false);
              setSolved(true);
              onTokenRef.current(token);
            },
            'expired-callback': () => invalidateToken(),
            'error-callback': errorCode => {
              if (!cancelled) {
                reportFailure(
                  'challenge',
                  verificationAttemptRef.current,
                  errorCode
                );
                invalidateToken(true);
              }
              return true;
            },
            'before-interactive-callback': () => invalidateToken(),
            'timeout-callback': () => {
              if (!cancelled) {
                reportFailure('timeout', verificationAttemptRef.current);
                invalidateToken(true);
              }
            },
            'unsupported-callback': () => {
              if (!cancelled) {
                reportFailure('unsupported', verificationAttemptRef.current);
                invalidateToken(true);
              }
            },
            // DECISION: keep the mounted iframe alive after success, but collapse its result.
            // Expiry, reset and interactive challenges restore visibility before collecting a token.
            // A manual retry must stay visible while Cloudflare evaluates the new challenge.
            // interaction-only otherwise hides the replacement iframe, which looks like it vanished.
            appearance: attempt > 0 ? 'always' : 'interaction-only',
            theme: 'auto',
          });
        })
        .catch(() => {
          // Script blocked / offline: without a token the backend rejects anyway
          // (fail-closed) and the parent shows the standard form error. Never crash the page.
          if (!cancelled) {
            reportFailure('initialization', verificationAttemptRef.current);
            setFailed(true);
            onTokenRef.current(null);
          }
        });
    });
    return () => {
      cancelled = true;
      unsubscribe();
      if (widgetIdRef.current !== null) {
        window.turnstile?.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [attempt, reportFailure]);

  useEffect(() => {
    if (resetNonce > 0 && widgetIdRef.current !== null) {
      setSolved(false);
      setFailed(false);
      onTokenRef.current(null);
      verificationAttemptRef.current += 1;
      window.turnstile?.reset(widgetIdRef.current);
    }
  }, [resetNonce]);

  if (!isTurnstileEnabled()) {
    return null;
  }
  return (
    <div>
      <div className={styles.widget} data-solved={solved} inert={solved}>
        <div className={styles.content}>
          <div ref={hostRef} />
        </div>
      </div>
      {failed && (
        <ButtonAtom
          type='button'
          variant='outlined'
          size='sm'
          onClick={() => {
            setFailed(false);
            setSolved(false);
            onTokenRef.current(null);
            setAttempt(n => n + 1);
          }}>
          {t('retry')}
        </ButtonAtom>
      )}
    </div>
  );
}
