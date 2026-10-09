/**
 * Wyciąga adresy plików z surowego archiwum `DeletedUser.body`.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Świadomie REKURENCYJNY spacer po całym drzewie zamiast wypisania ścieżek
 * (`stylist_account.gallery_record[]`, `stylist_visits[].result_photos[]`,
 * `client_visits[].result_photos[]`). Powód jest taki, że archiwum jest z założenia
 * ROSNĄCE: `userRelationsArchiveEnabler` ma własny kontrakt „dopisz tu każdy nowy
 * model kaskadowy", pilnowany osobnym audytem. Lista ścieżek zapisana tutaj
 * rozjechałaby się z nim po pierwszym nowym modelu ze zdjęciami — i to rozjechała
 * po cichu, bo brak ścieżki nie wywala się, tylko zostawia plik w chmurze.
 * Spacer po kluczach `asset_url`/`avatar_url` nadąża za archiwum bez dopisywania
 * czegokolwiek. Drugi klucz doszedł 2026-09-09 wraz ze ścieżką zapisu zdjęcia
 * profilowego: kolumna nazywa się inaczej niż reszta plików, więc spacer po samym
 * `asset_url` zostawiałby w chmurze zdjęcie twarzy usuniętego konta.
 *
 * Archiwum to JSON o luźnym kształcie (kolumna Json), więc funkcja jest odporna na
 * null/podmienione typy zamiast im ufać.
 *
 * Bezpiecznik: sam adres nie wystarcza do skasowania pliku — `cleanupCloudinaryAssets`
 * i tak sprawdza, czy nie odwołuje się do niego żaden żywy wiersz (fail-closed).
 */

/** Twardy sufit rekursji — archiwum jest płytkie, a to chroni przed cyklem w danych. */
const MAX_DEPTH = 12;

export const collectArchivedAssetUrls = (body: unknown): string[] => {
  const urls = new Set<string>();

  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || node === null || typeof node !== 'object') {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, depth + 1);
      }
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (
        (key === 'asset_url' || key === 'avatar_url') &&
        typeof value === 'string' &&
        value !== ''
      ) {
        urls.add(value);
        continue;
      }
      walk(value, depth + 1);
    }
  };

  walk(body, 0);
  return [...urls];
};
