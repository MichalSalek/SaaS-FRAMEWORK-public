/**
 * Cloudflare Turnstile widget (managed mode) — anty-spam formularzy publicznych.
 *
 * Zasady:
 *  - Renderuje się TYLKO gdy `isTurnstileEnabled()` (klucz by-presence,
 *    patrz turnstile.config.ts) — rodzic nie musi nic gate'ować.
 *  - Skrypt CF ładowany LAZY, dopiero po pierwszej ZAUFANEJ interakcji usera
 *    (trusted-interaction SSOT): zero kosztu LCP dla zwykłego ruchu i zero
 *    ekspozycji challenge'a dla crawlerów bez input-eventów.
 *  - Token jest JEDNORAZOWY: po każdej próbie submitu rodzic podbija
 *    `resetNonce`, co resetuje widget i unieważnia stary token.
 *  - CSP: `challenges.cloudflare.com` w script-src + frame-src (proxy.ts).
 */
import { useEffect, useRef } from 'react';
import { onTrustedInteraction } from '../../shared/interaction/trusted-interaction';
import {
  TURNSTILE_CONFIG,
  isTurnstileEnabled,
} from '../../../application/security/turnstile.config';

type TurnstileRenderParams = {
  sitekey: string;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
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

/**
 * Singleton loader — jeden <script> na pageload, niezależnie od liczby widgetów.
 *
 * DECISION (nie usuwaj tego komentarza): singleton jest CZYSZCZONY przy porażce.
 * Bez tego jeden nieudany load (chwilowy brak sieci przy wejściu na formularz,
 * przełączenie z komórki na wifi, blokada w rozszerzeniu) zostawiał w module
 * odrzuconą obietnicę NA STAŁE — każda kolejna próba, także po powrocie sieci,
 * dostawała natychmiastowe odrzucenie z pamięci i formularz był nie do wysłania
 * aż do przeładowania strony. Osierocony <script> też znika, żeby retry nie
 * zostawiał w <head> stosu martwych tagów.
 */
function loadTurnstile(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
      } else {
        reject(new Error('turnstile api missing after script load'));
      }
    };
    script.onerror = () => reject(new Error('turnstile script failed to load'));
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
  /** Świeży token po rozwiązaniu challenge'a; null gdy token wygasł/reset. */
  onToken: (token: string | null) => void;
  /** Podbij po każdej próbie submitu — token CF jest jednorazowy. */
  resetNonce: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!isTurnstileEnabled()) {
      return;
    }
    let cancelled = false;
    const unsubscribe = onTrustedInteraction(() => {
      void loadTurnstile()
        .then(api => {
          if (cancelled || widgetIdRef.current !== null || !hostRef.current) {
            return;
          }
          widgetIdRef.current = api.render(hostRef.current, {
            sitekey: TURNSTILE_CONFIG.SITE_KEY,
            callback: token => onTokenRef.current(token),
            'expired-callback': () => onTokenRef.current(null),
            'error-callback': () => onTokenRef.current(null),
            theme: 'auto',
          });
        })
        .catch(() => {
          // Script blocked / offline: bez tokenu backend i tak odrzuci (fail-closed),
          // a rodzic pokaże standardowy błąd formularza. Nigdy nie wysypujemy strony.
          onTokenRef.current(null);
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
  }, []);

  useEffect(() => {
    if (resetNonce > 0 && widgetIdRef.current !== null) {
      window.turnstile?.reset(widgetIdRef.current);
      onTokenRef.current(null);
    }
  }, [resetNonce]);

  if (!isTurnstileEnabled()) {
    return null;
  }
  return <div ref={hostRef} />;
}
