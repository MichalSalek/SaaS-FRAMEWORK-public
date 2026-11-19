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

    // DECISION: the marker file gates only the PRINT, never the verdict. It is keyed by PPID, and in
    // the production frontend environment both the PPID and /tmp survive restarts, so returning early
    // here let every boot after the first one with a missing variable start silently. Hard mode always
    // prints and exits. Mirrors printOnce in web-1/src/application/environment/env-schema.ts.
    const reserveFirstReport = (): boolean => {
      if (isBrowser || typeof process === 'undefined') {
        return true;
      }
      const flagFile = `/tmp/env_validated_${projectName}_${process.env?.PPID || process.ppid || 'unknown'}`;
      try {
        // DECISION: `typeof window === 'undefined'` must sit right at the `require`, not only in an
        // earlier return: Next replaces it with a constant in the client build, so the branch is
        // dead-code-eliminated and webpack never tries to resolve `fs`. Hoisting it to `isBrowser`
        // (or using `import fs`) leaves `fs` reachable for the bundler and brings back the
        // "Can't resolve 'fs'" warning, hence the deliberate no-require-imports exception.
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
