// main/src/UI/features/stylist/_website.helpers.ts
// Własna strona stylistki (stylist_account.website) — jedno miejsce, w którym
// decydujemy, czy wartość z bazy nadaje się do pokazania i jak ją podpisać.
// Używane przez JSON-LD (sameAs) oraz nagłówek profilu publicznego, żeby
// widoczny link i structured data nigdy nie rozjechały się co do zasad.

/**
 * Zwraca adres gotowy do użycia jako `href`/`sameAs` albo null.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Defense-in-depth przy RENDERZE. Write-path waliduje pole przez
 * `validateOptionalHttpsUrl` (wymaga pełnego https://, bez credentials), ale
 * profil publiczny renderuje wartość z DB i nie powinien ufać w ciemno —
 * przepuszczony `javascript:` trafiłby do `openExternalUrl` → `window.open`.
 * Stąd twarde żądanie protokołu https: zamiast prostego `Boolean(website)`.
 */
export function normalizeExternalHttpsUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || parsed.hostname.length === 0) {
      return null;
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      return null;
    }
  } catch {
    return null;
  }
  return trimmed;
}

/**
 * Podpis linku: bez `https://`, bez `www.` i bez końcowego ukośnika.
 * Linkujemy pełny adres, pokazujemy sam adres domeny (ścieżka zostaje, jeśli
 * stylistka poda głębszy link).
 */
export function formatExternalUrlLabel(url: string): string {
  return url
    .replace(/^https:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');
}
