/**
 * PII obfuscation — anti-crawler / anti-scraper SSOT (nailfolio front).
 *
 * ⛔ REGUŁA (czytaj, KAŻDA sesja): ŻADNE dane identyfikujące właściciela
 *    (nazwa firmy, NIP, adres siedziby) NIE mogą trafić na front (SSR HTML ani
 *    client bundle) jako PLAINTEXT. ZAWSZE przez te zaszyfrowane stałe +
 *    komponent <PiiText> / helper renderLegalText() z `Pii.tsx`.
 *    Nowa dana identyfikująca? → dodaj do scripts/gen-pii.mjs, zregeneruj,
 *    renderuj komponentem. NIGDY surowy string PII w JSX / JSON-LD / i18n.
 *    Strażnik regresji: `pii-plaintext-guard.test.ts` (failuje, gdy odkodowana
 *    wartość przecieknie do źródeł front-endu).
 *
 * Mechanika: wartości trzymamy XOR+base64-zakodowane. SSR renderuje „…";
 * JS odkodowuje je dopiero w przeglądarce, po pierwszej ZAUFANEJ interakcji
 * użytkownika (patrz Pii.tsx). Crawler / View Source / harvester widzi „…".
 *
 * To OBFUSKACJA, nie szyfrowanie — pokonuje boty / scrapery / indeksowanie PII,
 * NIE zdeterminowanego człowieka z DevTools (user MUSI widzieć wartość).
 *
 * Plaintext żyje TYLKO w `scripts/gen-pii.mjs` (dev-only, nie w bundlu).
 * Regeneracja: `node scripts/gen-pii.mjs` → wklej blok `PII`.
 * Algorytm tutaj MUSI być identyczny jak w scripts/gen-pii.mjs.
 */

const KEY = new TextEncoder().encode('example-placeholder-key');

/** Odkodowanie — wołane WYŁĄCZNIE po stronie klienta (useEffect w Pii.tsx). */
export function decodePii(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const xored = bytes.map((v, i) => v ^ (KEY[i % KEY.length] ?? 0));
  return new TextDecoder().decode(xored);
}

/**
 * Kodowanie RUNTIME-owej danej PII (symetryczne do decodePii — XOR tym samym
 * kluczem + base64). Dla danych DYNAMICZNYCH (nie build-time), np. telefon
 * stylistki z DB: kodujemy je SERVER-SIDE (getServerSideProps) zanim trafią do
 * propsów strony, dzięki czemu SSR HTML / __NEXT_DATA__ nie niesie plaintextu —
 * crawler/scraper widzi tylko blob, a <PiiTextAtom> odkodowuje po interakcji.
 * Build-time stałe właściciela (firma/NIP/adres) NADAL idą przez gen-pii.mjs;
 * ta funkcja jest dla per-rekordowych danych, których nie da się prekompilować.
 */
export function encodePii(plaintext: string): string {
  const bytes = new TextEncoder().encode(plaintext);
  const xored = bytes.map((v, i) => v ^ (KEY[i % KEY.length] ?? 0));
  let bin = '';
  for (const b of xored) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin);
}

/**
 * ━━━ REJESTR OBFUSKOWANYCH DANYCH (SSOT — czytaj, zanim cokolwiek dodasz/zmienisz) ━━━
 * Tożsamość prawna sprzedawcy (jednoosobowa działalność — NIP, brak KRS).
 * Renderowane na froncie WYŁĄCZNIE przez <PiiText> / renderLegalText() (Pii.tsx):
 *   • firma   — pełna nazwa sprzedawcy/administratora (art. 8 UŚUDE / art. 13 RODO)
 *   • nip     — NIP sprzedawcy
 *   • address — adres siedziby/doręczeń
 *
 * ➕ NOWA DANA IDENTYFIKUJĄCA? → 1) plaintext do `scripts/gen-pii.mjs`;
 *    2) `node scripts/gen-pii.mjs` → wklej nowy blob niżej; 3) renderuj komponentem.
 * Plaintext żyje TYLKO w gen-pii.mjs. Wartości poniżej są wynikiem gen-pii (round-trip OK).
 */
export const PII = {
  firma: 'IAAAAAAAAA0jGBQHDAdPJgULUmYEEhgJCwoE',
  nip: 'VEpSWUVaUhVJXA==',
  address: 'EBRPTSAeH1QbqeMCAQcYDURUXg1bVVRVSFFNJw0XXgoNFgI=',
} as const;
