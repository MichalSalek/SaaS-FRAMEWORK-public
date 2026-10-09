#!/usr/bin/env bash
# copy-phrase-blacklist.sh — Guard: banned AI-slop / fictional-team phrases.
#
# INTENT:
#   Owner-closed copy faults that keep coming back: "not a bot" as a quality
#   argument, "Polish team" as a department, Pro+/Pro Plus, empty adjectives.
#   CAPTCHA event copy that literally verifies humanity is allowlisted.
#
# EXIT: 0 if PASS, 1 if a banned phrase remains in live copy.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"

print_boxed_header "Copy phrase blacklist (bot/team/Pro+/empty adj)" "🚫"

set +e
REPORT=$(ROOT="$ROOT" node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const root = process.env.ROOT;
const files = [
  resolve(root, 'main/src/locales/pl/common.json'),
  resolve(root, 'main/src/locales/en/common.json'),
  resolve(root, 'main/src/locales/de/common.json'),
  resolve(root, 'main/src/locales/pl/events.json'),
  resolve(root, 'main/src/locales/en/events.json'),
  resolve(root, 'main/src/locales/de/events.json'),
  resolve(root, '.shared-kernel/domain/email/locales/email-i18n.pl.json'),
  resolve(root, '.shared-kernel/domain/email/locales/email-i18n.en.json'),
  resolve(root, '.shared-kernel/domain/email/locales/email-i18n.de.json'),
];

function walk(obj, prefix, out) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      walk(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return;
  }
  if (typeof obj === 'string') out.push([prefix, obj]);
}

const allowKey = (file, key) =>
  key === 'CAPTCHA_VERIFICATION_FAILED' || key.startsWith('static.reviews.');

const rules = [
  { name: 'polish-team', re: /polski zespół|Polish team|Polnisches Team/i },
  { name: 'not-a-bot-quality', re: /nie do bota|nie jesteśmy botem|not a bot|kein Bot/i },
  { name: 'pro-plus', re: /Pro Plus|Pro\+|Pro\s*\+/ },
  { name: 'empty-adj', re: /nowoczesn[yea]|intuicyjn|prosty w użyciu|easy to use|user[- ]friendly|einfach zu bedienen/i },
  { name: 'bank-grade', re: /standard bankowy|bank-grade|Bankenstandard/i },
  { name: 'shares-per-visit', re: /udostępnień na wizytę|shares per visit|Freigaben pro Besuch/i },
  // Country glued to a year is not a promise. Timeline keys may say "2025" alone.
  { name: 'country-year-chip', re: /(Polska|Poland|Polen|firma|company|Unternehmen)\s*·\s*20\d{2}/i },
  // Nationality as a quality badge (competitors are Polish too). Location = Kraków + a verb.
  { name: 'polish-as-quality', re: /Polska aplikacja|To polskie narzędzie|It is a Polish tool|ein polnisches Tool/i },
  // Founder CV / programmer-blog voice on a SaaS page (About is product story, not a resume).
  { name: 'founder-it-cv', re: /korzeniami w IT|IT background|Wurzeln in der IT/i },
  { name: 'write-the-code-identity', re: /Piszę kod|I write the code|Ich schreibe den Code/i },
  { name: 'architecture-code-bio', re: /architektura, kod|architecture, code|Architektur, Code/i },
  // Given name of the founder never appears in product copy. Legal identity
  // lives only in PP/ToS via __PII_*__ + PiiText (obfuscated). GitHub URLs
  // (MichalSalek) are not in these JSON/index surfaces.
  { name: 'founder-given-name', re: /Michał|Michal/ },
];

const textSurfaces = [
  resolve(root, 'main/public/llms.txt'),
  resolve(root, 'main/public/llms-pl.txt'),
  resolve(root, 'main/public/llms-de.txt'),
];

const hits = [];
for (const path of files) {
  const rel = path.slice(root.length + 1);
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const leaves = [];
  walk(doc, '', leaves);
  for (const [key, val] of leaves) {
    for (const rule of rules) {
      if (rule.name !== 'founder-given-name' && allowKey(rel, key)) continue;
      if (rule.re.test(val)) hits.push(`${rel}\t${key}\t${rule.name}\t${val.slice(0, 90)}`);
    }
  }
}
for (const path of textSurfaces) {
  const rel = path.slice(root.length + 1);
  const val = readFileSync(path, 'utf8');
  for (const rule of rules) {
    if (rule.name !== 'founder-given-name') continue;
    if (rule.re.test(val)) hits.push(`${rel}\t(file)\t${rule.name}\t${val.match(rule.re)?.[0] ?? ''}`);
  }
}

// DECISION (nie usuwaj tego komentarza) — S113, 2026-09-10:
// Trzecia powierzchnia: LITERAŁY ŁAŃCUCHOWE w kodzie źródłowym. Strażnik czytał
// wyłącznie pliki i18n i `llms*.txt`, więc każde copy wpisane wprost w komponent
// było dla niego niewidzialne. Zmierzone: `ui-library/UiLibrarySections.lp.organism.tsx`
// niosło „Polski zespół wsparcia" — bezpośrednie trafienie reguły `polish-team`,
// przy zielonym audycie. To nie jest teoria: to JEDYNY tryb, w jakim zakazana fraza
// może dziś wejść do repo, bo pliki i18n są pilnowane.
//
// Skanujemy TYLKO literały, po odcięciu komentarzy: polskie komentarze DECISION są
// w tym repo gęste i pełne słów z reguły `empty-adj` („intuicyjn", „nowoczesn"),
// więc skan surowego tekstu utonąłby w fałszywych alarmach. `founder-given-name`
// jest tu WYŁĄCZONA — w kodzie legalnie występują URL-e GitHuba (MichalSalek)
// i ścieżki, a reguła pilnuje copy dla użytkownika, nie identyfikatorów.
// Zmierzone po naprawie: 0 trafień na ~2000 plikach, więc podłoga jest realna.
const sourceFiles = execSync(
  'find main/src web-1/src .shared-kernel \\( -name "*.ts" -o -name "*.tsx" \\) ' +
    '-not -path "*/READONLY-shared-kernel/*" -not -path "*/node_modules/*" ' +
    '-not -name "*.test.ts" -not -name "*.test.tsx"',
  { cwd: root, encoding: 'utf8', maxBuffer: 1e8 }
)
  .trim()
  .split('\n')
  .filter(Boolean);

for (const rel of sourceFiles) {
  const src = readFileSync(resolve(root, rel), 'utf8');
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/[^\n"'`]*$/gm, '');
  const literals = stripped.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) || [];
  for (const literal of literals) {
    for (const rule of rules) {
      if (rule.name === 'founder-given-name') continue;
      if (rule.re.test(literal)) {
        hits.push(`${rel}\t(literal)\t${rule.name}\t${literal.slice(0, 90)}`);
      }
    }
  }
}
if (hits.length) {
  console.log(hits.join('\n'));
  process.exit(2);
}
NODE
)
STATUS=$?
set -e

print_separator
if [[ "$STATUS" -eq 2 ]]; then
  print_error "Phrase blacklist FAILED:"
  echo ""
  echo "$REPORT"
  echo ""
  echo "Banned: Polish team / not-a-bot / Pro+ / empty adj / founder given name."
  echo "CAPTCHA_VERIFICATION_FAILED and static.reviews.* are exempt (except founder name)."
  exit 1
elif [[ "$STATUS" -ne 0 ]]; then
  print_error "copy-phrase-blacklist scanner crashed (exit ${STATUS})"
  echo "$REPORT"
  exit 1
fi
print_success "Banned copy phrases absent (CAPTCHA + reviews exempt)"
exit 0
