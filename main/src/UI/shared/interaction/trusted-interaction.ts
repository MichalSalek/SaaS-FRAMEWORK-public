/**
 * Trusted-interaction gate — reużywalny mechanizm anty-bot (SSOT).
 *
 * Jedna, współdzielona brama "czy prawdziwy użytkownik wszedł w interakcję ze
 * stroną": false aż do PIERWSZEGO ZAUFANEGO zdarzenia wejściowego (ruch myszy /
 * pointer / wheel / tap / klawisz / klik), potem true na zawsze (per pageload).
 *
 * Konsumenci (przez hook `useTrustedInteraction` albo imperatywnie):
 *  - <PiiTextAtom> — odsłania obfuskowane PII dopiero po interakcji,
 *  - formularze publiczne (contact / newsletter) — odblokowują submit dopiero
 *    po interakcji + twarda ifka w handlerze wysyłki (bot omijający `disabled`
 *    w DOM i tak utknie na `hasTrustedInteraction()`),
 *  - lazy-load skryptów 3rd-party, które mają sens tylko dla ludzi (Turnstile).
 *
 * Dlaczego to działa na boty: crawlery i harvestery WYKONUJĄCE JS renderują
 * stronę, ale nie syntezują zaufanych zdarzeń wejściowych. Zdarzenia z
 * `dispatchEvent` (GTM / 3rd-party / bot w konsoli) mają `isTrusted === false`
 * i są ignorowane.
 *
 * ⚠️ EVENTS celowo BEZ 'scroll' i 'focusin': oba bywają syntezowane przez samą
 *    aplikację/przeglądarkę BEZ udziału usera (programatyczny .focus(),
 *    scroll-restoration / nawigacja do #hash). Klawiatura: Tab/strzałki
 *    generują 'keydown' (gate przechodzi), więc a11y zachowane.
 *
 * To OBFUSKACJA/heurystyka, nie twarde bezpieczeństwo — determinowany bot z
 * realnym silnikiem input-eventów (CDP) przejdzie; od tego jest server-side
 * Turnstile (web-1). Warstwy się SUMUJĄ, nie zastępują.
 */
import { useEffect, useState } from 'react';

const TRUSTED_EVENTS = [
  'pointerdown',
  'pointermove',
  'mousemove',
  'wheel',
  'touchstart',
  'keydown',
  'click',
] as const;

let interacted = false;
let armed = false;
const waiters = new Set<() => void>();

function fireInteraction(e?: Event): void {
  if (interacted) {
    return;
  }
  // Tylko ZAUFANE zdarzenia od użytkownika. Syntetyczne (dispatchEvent,
  // isTrusted=false) z analytics / GTM / 3rd-party NIE otwierają bramy.
  if (e && !e.isTrusted) {
    return;
  }
  interacted = true;
  TRUSTED_EVENTS.forEach(ev => window.removeEventListener(ev, fireInteraction));
  waiters.forEach(fn => fn());
  waiters.clear();
}

function armListeners(): void {
  if (typeof window === 'undefined' || interacted || armed) {
    return;
  }
  armed = true;
  TRUSTED_EVENTS.forEach(ev =>
    window.addEventListener(ev, fireInteraction, { passive: true })
  );
}

/**
 * Imperatywny odczyt bramy — do twardych ifek w handlerach wysyłki
 * (`if (!hasTrustedInteraction()) return;`), gdzie hook nie wystarcza,
 * bo bot może wywołać handler mimo `disabled` na przycisku.
 */
export function hasTrustedInteraction(): boolean {
  return interacted;
}

/**
 * Imperatywna subskrypcja (poza Reactem). Zwraca unsubscribe. Gdy brama już
 * otwarta — callback odpala się synchronicznie od razu.
 */
export function onTrustedInteraction(cb: () => void): () => void {
  if (interacted) {
    cb();
    return () => undefined;
  }
  armListeners();
  waiters.add(cb);
  return () => {
    waiters.delete(cb);
  };
}

/** false do PIERWSZEJ zaufanej interakcji (ruch / tap / click / wheel / key), potem true. */
export function useTrustedInteraction(): boolean {
  const [trusted, setTrusted] = useState(false);
  useEffect(() => {
    if (interacted) {
      setTrusted(true);
      return;
    }
    armListeners();
    const wake = (): void => setTrusted(true);
    waiters.add(wake);
    return () => {
      waiters.delete(wake);
    };
  }, []);
  return trusted;
}
