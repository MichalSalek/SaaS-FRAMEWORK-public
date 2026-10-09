#!/bin/bash

# I18N INTERPOLATION PARITY AUDIT
# In run-all (npm run audit:all / git:push).
#
# Verifies that every translation key uses the SAME set of CONTENT parameters
# in every locale (pl/en/de). Catches the real drift class (S39, 2026-07-02):
# PL says "…plan {plan}…" while EN/DE hardcode "…the Pro subscription…" —
# the key renders fine today, silently rots the day the plan name changes,
# and is INVISIBLE to key-presence parity audits (all locales have the key).
#
# CONTENT parameter = something the message actually renders from data:
#   - bare ICU argument {param} (also number/date/time skeletons),
#   - a SELECT selector ({plan, select, …} — branches are data-driven variants),
#   - '#' inside a plural branch (renders the parent argument),
#   - next-intl rich tags <tag></tag>.
# A PLURAL selector used only for inflection (PL "{count, plural, one
# {przypięta} …}" vs invariant EN "pinned") is GRAMMAR, not content — locales
# legitimately differ there, so plural selectors without '#' and without bare
# use are deliberately excluded (keeps the audit FP-free without any allowlist).
#
# Kernel email group additionally hard-fails on MALFORMED templating: spaced
# "{{ key }}", dotted "{{a.b}}", or single-brace "{key}" — the kernel renderer
# interpolates EXACTLY /\{\{(\w+)\}\}/, so any of these would reach the inbox
# verbatim even when consistent across all locales.
#
# Scanned groups (each with its template syntax):
#   1. main/src/locales/{pl,en,de}/common.json   — ICU (next-intl)
#   2. main/src/locales/{pl,en,de}/events.json   — ICU (next-intl)
#   3. .shared-kernel/domain/email/locales/email-i18n.{pl,en,de}.json
#      — mustache {{param}} (kernel email renderer; NOT ICU by design)
#
# ICU parse failure in an ICU group is ALSO a failure: a malformed message
# would throw inside next-intl at runtime. Parser = the same
# @formatjs/icu-messageformat-parser that next-intl uses (main/node_modules).
#
# EXIT: 0 if PASS, 1 if any mismatch / parse failure / missing file.

set -u

source "$(dirname "$0")/_utils.sh"

PROJECT_ROOT=$(get_project_root)
PARSER_DIR="$PROJECT_ROOT/main/node_modules/@formatjs/icu-messageformat-parser"

print_boxed_header "I18N INTERPOLATION PARITY (content params per key)"

if [[ ! -d "$PARSER_DIR" ]]; then
    print_error "@formatjs/icu-messageformat-parser not found — run 'npm install' in main/ first"
    exit 1
fi

RESULT=$(PROJECT_ROOT="$PROJECT_ROOT" node <<'NODE_EOF'
const fs = require('fs');
const path = require('path');
const ROOT = process.env.PROJECT_ROOT;
const parser = require(path.join(ROOT, 'main/node_modules/@formatjs/icu-messageformat-parser'));

const GROUPS = [
  { name: 'main common.json', syntax: 'icu', files: { pl: 'main/src/locales/pl/common.json', en: 'main/src/locales/en/common.json', de: 'main/src/locales/de/common.json' } },
  { name: 'main events.json', syntax: 'icu', files: { pl: 'main/src/locales/pl/events.json', en: 'main/src/locales/en/events.json', de: 'main/src/locales/de/events.json' } },
  { name: 'kernel email-i18n', syntax: 'mustache', files: { pl: '.shared-kernel/domain/email/locales/email-i18n.pl.json', en: '.shared-kernel/domain/email/locales/email-i18n.en.json', de: '.shared-kernel/domain/email/locales/email-i18n.de.json' } },
];

function flatten(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (Array.isArray(v)) v.forEach((item, i) => {
      if (typeof item === 'string') out[`${key}[${i}]`] = item;
      else if (item && typeof item === 'object') flatten(item, `${key}[${i}]`, out);
      else if (item !== null) out[`${key}[${i}]`] = String(item);
    });
    else if (v && typeof v === 'object') flatten(v, key, out);
    // Liść nie-string (number/boolean) NIE znika z porównania — locale
    // hardcodujący JSON-liczbę tam, gdzie inne interpolują string, to ta
    // sama klasa driftu (porównuje się jako content bez parametrów).
    else if (v !== null) out[key] = String(v);
  }
  return out;
}

// AST TYPES (formatjs): 1=argument 2=number 3=date 4=time 5=select 6=plural 7=pound(#) 8=tag
// select (5) selector = CONTENT: gałęzie renderują warianty sterowane DANYMI
// ("{plan, select, PRO {Pro}…}" vs hardcode "Pro" = dokładnie klasa S39 przez
// select; korpus 2026-07-02 ma 0 selectów, więc reguła jest bez-FP — gdyby
// kiedyś wszedł select czysto gramatyczny (rodzaj), doprecyzować wtedy).
// plural (6) selector = GRAMATYKA (fleksja), content dopiero przez '#'.
function collectContent(ast, set, pluralArg) {
  for (const el of ast) {
    if (el.type >= 1 && el.type <= 4) set.add(el.value);
    if (el.type === 5) set.add(el.value);
    if (el.type === 7 && pluralArg) set.add(pluralArg);
    if (el.type === 8) { set.add(`<${el.value}>`); collectContent(el.children, set, pluralArg); }
    if (el.type === 5 || el.type === 6) {
      for (const opt of Object.values(el.options)) collectContent(opt.value, set, el.value);
    }
  }
  return set;
}

function extractParams(msg, syntax) {
  if (syntax === 'mustache') {
    // STRICT {{key}} — renderer kernela (email-template.renderer.ts) robi
    // literal replace /\{\{(\w+)\}\}/ bez trimowania: "{{ key }}", kropka w
    // nazwie i pojedynczy "{key}" NIE interpolują i wyszłyby w mailu dosłownie.
    // Char-class = \w (parytet 1:1 z rendererem); każdy odstępca = malformed.
    // S122: liczba mnoga {{key#forma|formy|form}} (expandPluralPlaceholders w
    // email-stats.ts) — parametr = część przed '#', formy nie mogą być puste
    // ani zawierać klamer. Parytet porównuje nazwy parametrów, nie formy
    // (formy są z definicji różne w każdym języku).
    const plural = /\{\{([A-Za-z0-9_]+)#([^{}|]+(?:\|[^{}|]+)*)\}\}/g;
    const pluralParams = [...msg.matchAll(plural)].map(m => m[1]);
    const rest = msg.replace(plural, '');
    const malformed = rest.match(/\{\{(?![A-Za-z0-9_]+\}\})/);
    if (malformed) throw new Error('malformed mustache (spacja/kropka/zły znak w {{…}} — renderer nie zinterpoluje)');
    const singleBrace = rest.match(/(^|[^{])\{[A-Za-z0-9_]+\}(?!\})/);
    if (singleBrace) throw new Error('single-brace {x} w grupie mustache — renderer interpoluje tylko {{x}}');
    const plain = [...rest.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)].map(m => m[1]);
    return [...plain, ...pluralParams].sort().join(',');
  }
  return [...collectContent(parser.parse(msg), new Set(), null)].sort().join(',');
}

let mismatches = 0, parseFails = 0, missingFiles = 0;
const lines = [];
for (const g of GROUPS) {
  const flat = {};
  for (const [loc, rel] of Object.entries(g.files)) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { missingFiles++; lines.push(`MISSING-FILE ${rel}`); continue; }
    flat[loc] = flatten(JSON.parse(fs.readFileSync(p, 'utf8')), '', {});
  }
  const allKeys = new Set(Object.values(flat).flatMap(o => Object.keys(o)));
  let groupMismatch = 0;
  for (const key of allKeys) {
    const sets = {};
    for (const loc of Object.keys(flat)) {
      const msg = flat[loc][key];
      if (msg === undefined) continue;
      try { sets[loc] = extractParams(msg, g.syntax); }
      catch (e) {
        parseFails++;
        lines.push(`PARSE-FAIL [${g.name}] ${loc} ${key}: ${String(e.message).slice(0, 80)}`);
        sets[loc] = null;
      }
    }
    const vals = Object.values(sets).filter(v => v !== null);
    if (vals.length >= 2 && new Set(vals).size > 1) {
      groupMismatch++; mismatches++;
      lines.push(`MISMATCH [${g.name}] ${key}`);
      for (const [loc, s] of Object.entries(sets)) lines.push(`   ${loc}: {${s ?? 'PARSE-FAIL'}}`);
    }
  }
  lines.push(`GROUP ${g.name}: keys=${allKeys.size} mismatches=${groupMismatch}`);
}
lines.push(`TOTAL mismatches=${mismatches} parseFails=${parseFails} missingFiles=${missingFiles}`);
console.log(lines.join('\n'));
process.exit(mismatches + parseFails + missingFiles > 0 ? 1 : 0);
NODE_EOF
)
NODE_EXIT=$?

echo "$RESULT" | while IFS= read -r line; do
    case "$line" in
        MISMATCH*|PARSE-FAIL*|MISSING-FILE*) echo -e "${RED}${line}${NC}" ;;
        GROUP*) echo -e "${BOLD}${line}${NC}" ;;
        *) echo "$line" ;;
    esac
done

echo ""
print_header "SUMMARY"
if [[ $NODE_EXIT -eq 0 ]]; then
    echo -e "${GREEN}PASSED:${NC} content-parameter sets identical across locales (grammar-only plural selectors excluded by design)"
else
    echo -e "${RED}FAILED:${NC} interpolation drift between locales"
    echo -e "${YELLOW}Fix: align the {param} usage across pl/en/de — a locale hardcoding a value the others interpolate rots silently${NC}"
fi

exit $NODE_EXIT
