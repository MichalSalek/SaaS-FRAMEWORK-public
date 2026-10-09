export const normalizeString = (value: string | undefined) =>
  value?.trim() ?? '';

export const normalizeBool = (value: string | undefined, fallback = false) => {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return fallback;
};

export const validateEnv = (
  vars: Record<string, string | boolean | undefined>,
  projectName: string = 'app'
) => {
  const missing = Object.entries(vars)
    .filter(([_, value]) => value === '' || value === undefined)
    .map(([key]) => key);

  if (missing.length > 0) {
    // STAGING USUNIETE z soft (2026-06): staging waliduje sie TWARDO jak prod
    // (preview zrezygnowane, staging przejal role pre-prod). Soft = tylko DEVELOPMENT.
    const isSoftMode =
      vars.NEXT_PUBLIC_NODE_ENV_MANUAL === 'DEVELOPMENT' ||
      vars.NODE_ENV_MANUAL === 'DEVELOPMENT' ||
      (typeof process !== 'undefined' &&
        process.env?.NODE_ENV === 'development');

    const isBrowser = typeof window !== 'undefined';

    // DECISION (nie usuwaj tego komentarza) — TLUMIENIE DOTYCZY WYDRUKU, NIGDY WERDYKTU:
    // ten blok mial kiedys ksztalt `catch (EEXIST) { return }` WEWNATRZ validateEnv, wiec
    // istniejacy plik-znacznik nie wyciszal powtorzonego komunikatu, tylko WYCHODZIL z calej
    // funkcji — pomijajac `process.exit(1)` / `throw` nizej. Brakujaca krytyczna zmienna
    // srodowiskowa przestawala wiec zatrzymywac start. To nie jest przypadek teoretyczny:
    // znacznik jest kluczowany PPID-em, a w srodowisku produkcyjnym frontu PPID jest STALY
    // miedzy restartami aplikacji, a /tmp przezywa restart —
    // pierwszy start z brakiem zmiennej tworzyl znacznik i padal, a KAZDY nastepny restart
    // (nadal z brakiem) juz cicho wstawal. Fail-open dokladnie tam, gdzie bramka ma trzymac.
    // Dlatego rezerwacja zwraca teraz BOOLEAN i bramkuje wylacznie wydruk, a tryb twardy
    // drukuje i konczy proces bezwarunkowo. Parytet 1:1 z `printOnce` w
    // web-1/src/application/environment/env-schema.ts (rodzenstwo mialo to zrobione dobrze).
    const reserveFirstReport = (): boolean => {
      if (isBrowser || typeof process === 'undefined') {
        return true;
      }
      const flagFile = `/tmp/env_validated_${projectName}_${process.env?.PPID || process.ppid || 'unknown'}`;
      try {
        // DECISION (nie usuwaj tego komentarza) — `typeof window === 'undefined'` MUSI stac
        // DOKLADNIE TUTAJ, przy samym `require`, a nie tylko jako wczesniejszy `return`:
        // w buildzie klienckim Next podmienia `typeof window` na stala, wiec ta galaz znika
        // przy eliminacji martwego kodu i webpack nigdy nie probuje rozwiazac `fs`.
        // Przeniesienie tego warunku wyzej (do `isBrowser` na wejsciu funkcji) zostawia
        // `require('fs')` bezwarunkowe dla bundlera i wraca ostrzezenie buildu
        // „Module not found: Can't resolve 'fs'" w paczce przegladarkowej.
        // Z tego samego powodu `require` MUSI zostac `require`: statyczny `import fs`
        // jest bezwarunkowy z definicji, wiec trafilby do paczki klienckiej niezaleznie
        // od jakiegokolwiek warunku w kodzie. Stad swiadomy wyjatek od no-require-imports.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = typeof window === 'undefined' ? require('fs') : null;
        if (fs === null) {
          return true;
        }
        try {
          const fd = fs.openSync(flagFile, 'wx');
          fs.closeSync(fd);
          return true;
        } catch (err) {
          if (
            typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            (err as { code?: unknown }).code === 'EEXIST'
          ) {
            return false;
          }
          return true;
        }
      } catch {
        // Brak dostepu do FS (np. runtime bez `fs`) — nie tlumimy niczego.
        return true;
      }
    };

    const RED = '\x1b[31m';
    const YELLOW = '\x1b[33m';
    const RESET = '\x1b[0m';
    const BOLD = '\x1b[1m';

    const statusText = isSoftMode
      ? '(WARNING - SOFT MODE)'
      : '(CRITICAL ERROR)';
    const title = `${YELLOW}MISSING ENVIRONMENT VARIABLES ${statusText} - [${projectName.toUpperCase()}]${RED}`;

    const errorMessage = `
${RED}${BOLD}│
│   ${title}
│
${missing.map(key => `│   • ${key}`).join('\n')}
│
│   ${BOLD}Please check your .env files and restart the application.${RED}
│${RESET}
    `;

    if (isSoftMode) {
      // Tryb miekki (DEVELOPMENT) = samo ostrzezenie, wiec tu tlumienie powtorzen jest
      // bezpieczne: nie ma werdyktu do pominiecia.
      if (reserveFirstReport()) {
        console.warn(errorMessage);
      }
      return;
    }

    // Tryb twardy: drukujemy i konczymy BEZWARUNKOWO — zadnego tlumienia.
    if (isBrowser) {
      console.error('%c' + errorMessage, 'color: red; font-weight: bold;');
      throw new Error(
        `Critical: Missing environment variables in ${projectName}: ${missing.join(', ')}`
      );
    } else {
      console.error(errorMessage);
      if (
        typeof process !== 'undefined' &&
        typeof process.exit === 'function'
      ) {
        process.exit(1);
      }
    }
  }
};
