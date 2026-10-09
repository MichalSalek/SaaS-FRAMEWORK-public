// tests/prod/prod-config.ts
//
// Konfiguracja testów uruchamianych PRZECIW PRODUKCJI.
//
// DLACZEGO OSOBNO OD tests/e2e: tamta suita zakłada dev-login (endpoint zamknięty
// poza środowiskiem deweloperskim) i wolno jej pisać do bazy do woli. Tutaj
// pracujemy na żywym systemie, więc obowiązują dwie zasady:
//   1. logujemy się TYLKO tak, jak realny użytkownik (magic-link odebrany ze
//      skrzynki po IMAP) — produkcja nie dostaje żadnej furtki logowania,
//   2. testy są nieinwazyjne (czytają, nie kasują cudzych danych).
//
// Sekrety skrzynki testowej żyją w lokalnym pliku z sekretami (poza repozytorium):
//   E2E_MAILBOX_USER / E2E_MAILBOX_PASSWORD / E2E_MAILBOX_IMAP_HOST / _PORT
// Powłoka ładuje ten plik automatycznie, więc zwykłe `npm run test:prod` działa
// bez dodatkowych kroków.

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Brak zmiennej ${key}. Dane skrzynki testowej są w lokalnym pliku z sekretami — ` +
        'otwórz nową powłokę albo załaduj ten plik (`source <plik-z-sekretami>`).'
    );
  }
  return value;
};

export const PROD_CONFIG = {
  FRONTEND_URL: process.env['PROD_FRONTEND_URL'] ?? 'https://nailfolio.app',
  BACKEND_URL: process.env['PROD_BACKEND_URL'] ?? 'https://api.nailfolio.app',
  /** Konto testowe zakładane na produkcji przy pierwszym uruchomieniu suity. */
  get MAILBOX_USER(): string {
    return requireEnv('E2E_MAILBOX_USER');
  },
  get MAILBOX_PASSWORD(): string {
    return requireEnv('E2E_MAILBOX_PASSWORD');
  },
  get IMAP_HOST(): string {
    return requireEnv('E2E_MAILBOX_IMAP_HOST');
  },
  get IMAP_PORT(): number {
    return Number(process.env['E2E_MAILBOX_IMAP_PORT'] ?? '993');
  },
  /** Ile czekamy na maila z linkiem, zanim uznamy dostarczanie za zepsute. */
  MAIL_TIMEOUT_MS: Number(process.env['PROD_MAIL_TIMEOUT_MS'] ?? '120000'),
} as const;

/** Czy w środowisku są w ogóle dane skrzynki (bez nich robimy tylko część bez logowania). */
export const hasMailboxCredentials = (): boolean =>
  Boolean(
    process.env['E2E_MAILBOX_USER'] && process.env['E2E_MAILBOX_PASSWORD']
  );
