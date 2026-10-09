import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * DECISION (nie usuwaj tego komentarza):
 * BUILD_ID Next.js = tożsamość ARTEFAKTU, nie numer wersji. Deploy-gate
 * (`scripts/deploy/deploy-backend`) czyta lokalnie `.next/BUILD_ID` tuż po buildzie
 * i porównuje go z tym, co raportuje ŻYWY proces — dopiero ta równość dowodzi, że
 * prod serwuje wypchnięty artefakt. Samo `uptime_seconds < 300` mówi wyłącznie
 * „proces jest świeży", a świeży proces potrafi wstać na STARYM artefakcie (restart
 * Rendera, OOM, `build_failed` na topie — precedens 2026-07-19: 2× build_failed
 * niezauważone 2 tygodnie, health przez cały czas zielony).
 *
 * Czytamy PLIK, a nie stałą wstrzykniętą przez `next.config` (`env`/`generateBuildId`),
 * bo plik jest tym samym bajtem, który czyta skrypt deployu — zero szansy na rozjazd
 * i zero wpływu na cache-busting Next.
 *
 * Ekspozycja publiczna jest bezpieczna: BUILD_ID to losowy hash bez informacji o
 * wersji, stacku czy sekretach (na froncie i tak żyje jawnie w ścieżkach
 * `/_next/static/<buildId>/`).
 */

/** Wartość raportowana, gdy artefaktu nie da się odczytać (m.in. `next dev`). */
export const UNKNOWN_BUILD_ID = 'unknown';

/**
 * Cache module-level: health-check bywa pingowany co ~2 s przez monitory uptime, a
 * BUILD_ID nie zmienia się w cyklu życia procesu. Odczyt jest idempotentny, więc
 * podwójne zbundlowanie modułu (instrumentation vs pages/api — patrz gotcha
 * „double-bundle state") daje najwyżej drugi, identyczny odczyt: bez konsekwencji.
 */
let cachedBuildId: string | null = null;

export const getBuildId = (): string => {
  if (cachedBuildId !== null) {
    return cachedBuildId;
  }

  try {
    const raw = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8');
    const trimmed = raw.trim();
    cachedBuildId = trimmed.length > 0 ? trimmed : UNKNOWN_BUILD_ID;
  } catch {
    // Brak pliku = tryb dev albo nietypowy cwd. Health MUSI odpowiedzieć mimo to —
    // to probe liveness, nie diagnostyka artefaktu. Deploy-gate rozpozna 'unknown'
    // i powie wprost, że nie potwierdził artefaktu, zamiast wisieć bez wyjaśnienia.
    cachedBuildId = UNKNOWN_BUILD_ID;
  }

  return cachedBuildId;
};
