// Preflight walidacji env dla prod deployu (Render build command).
//
// Build command Rendera: `prisma migrate deploy && node scripts/preflight-prod-env.mjs`.
// Cel: jesli Render NIE ma kompletu wymaganych zmiennych prod, BUILD PADA (exit 1)
// ZANIM nowy serwis wystartuje i przejmie ruch -> stary instance zostaje live (zero
// downtime). Bez tego brak zmiennej ujawnilby sie dopiero przy starcie (crash-loop
// po przelaczeniu ruchu).
//
// SSOT wymagan = src/application/environment/env-schema.ts. Ten skrypt PARSUJE ten
// plik (zero duplikacji listy), wiec dodanie/zmiana speca tam automatycznie tu dziala.
// Aplikacja i tak waliduje env na starcie (fail-fast w PRODUCTION); to jest ta sama
// reguła przeniesiona na etap builda. Zmienne warunkowe (`requiredWhen`, np.
// DATABASE_APP_LOGS_URL gated by ENABLE_APP_LOGS_DB) zostawiamy walidacji runtime
// aplikacji - ich predykatu nie ewaluujemy tutaj (parser tekstowy, nie wykonuje TS).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(here, '..', 'src', 'application', 'environment', 'env-schema.ts');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function parseSchema(text) {
  // Ogranicz parsowanie DO tablicy ENV_SCHEMA (od nazwy do `] as const`), inaczej
  // chunk ostatniego speca siegalby EOF i lapal `requiredWhen` z kodu walidatora
  // ponizej tablicy (false-positive — ostatni spec bledne oznaczany jako warunkowy).
  const startIdx = text.indexOf('ENV_SCHEMA');
  const endIdx = text.indexOf('] as const', startIdx);
  const body = text.slice(startIdx, endIdx === -1 ? text.length : endIdx);
  const nameMatches = [...body.matchAll(/name:\s*'([^']+)'/g)];
  const specs = [];
  for (let i = 0; i < nameMatches.length; i++) {
    const start = nameMatches[i].index;
    const end = i + 1 < nameMatches.length ? nameMatches[i + 1].index : body.length;
    const chunk = body.slice(start, end);
    const reqMatch = chunk.match(/required:\s*'([^']+)'/);
    specs.push({
      name: nameMatches[i][1],
      required: reqMatch ? reqMatch[1] : 'optional',
      hasRequiredWhen: /requiredWhen/.test(chunk),
    });
  }
  return specs;
}

function main() {
  let schemaText;
  try {
    schemaText = readFileSync(SCHEMA_PATH, 'utf8');
  } catch (err) {
    console.error(`${RED}${BOLD}[preflight] Nie moge wczytac env-schema: ${SCHEMA_PATH}${RESET}`);
    console.error(`${RED}${err.message}${RESET}`);
    process.exit(1);
  }

  const specs = parseSchema(schemaText);
  if (specs.length === 0) {
    console.error(`${RED}${BOLD}[preflight] Parser nie znalazl zadnego speca w env-schema — przerwij, cos sie zmienilo w formacie.${RESET}`);
    process.exit(1);
  }

  const mode = (process.env.NODE_ENV_MANUAL ?? '').trim();
  const isProd = mode === 'PRODUCTION' || mode === 'STAGING';

  const requiredHere = specs.filter(s => {
    if (s.hasRequiredWhen) return false; // warunkowe -> walidacja runtime aplikacji
    if (s.required === 'always') return true;
    if (s.required === 'prod') return isProd;
    return false;
  });

  const isMissing = name => {
    const v = process.env[name];
    return v === undefined || v.trim() === '';
  };

  const missing = requiredHere.filter(s => isMissing(s.name)).map(s => s.name);
  const deferred = specs.filter(s => s.hasRequiredWhen).map(s => s.name);

  console.log(`${BOLD}[preflight] tryb=${mode || '(brak NODE_ENV_MANUAL)'} | wymaganych tu=${requiredHere.length} | sprawdzono z env-schema=${specs.length}${RESET}`);
  if (deferred.length) {
    console.log(`${YELLOW}[preflight] warunkowe (requiredWhen) -> walidacja runtime aplikacji: ${deferred.join(', ')}${RESET}`);
  }

  if (missing.length > 0) {
    console.error(`\n${RED}${BOLD}[preflight] BRAK ${missing.length} wymaganych zmiennych prod — BUILD ZATRZYMANY:${RESET}`);
    for (const name of missing) console.error(`${RED}  • ${name}${RESET}`);
    console.error(`\n${RED}Ustaw je w dashboardzie Rendera (Environment) i zrob redeploy.${RESET}\n`);
    process.exit(1);
  }

  console.log(`${GREEN}${BOLD}[preflight] OK — komplet wymaganych zmiennych prod obecny.${RESET}`);
  process.exit(0);
}

main();
