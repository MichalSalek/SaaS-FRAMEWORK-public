#!/usr/bin/env bash
# copy-de-sie.sh — Guard: German UI copy stays on Sie (BRAND_BIBLE §7.4).
#
# INTENT:
#   DE is Sie everywhere, including in-app. Du/dein/dich/dir and a short list
#   of bare 2sg imperatives are leaks. Literal quotes in static.reviews.*
#   (reported speech) are the only allowlisted exception.
#
# EXIT: 0 if PASS, 1 if a leak is found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"

print_boxed_header "German copy: Sie-Form (no du/dein/dich/dir)" "DE"

set +e
REPORT=$(ROOT="$ROOT" node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.env.ROOT;
const files = [
  ['common', resolve(root, 'main/src/locales/de/common.json')],
  ['events', resolve(root, 'main/src/locales/de/events.json')],
  ['email', resolve(root, '.shared-kernel/domain/email/locales/email-i18n.de.json')],
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

const pronoun = /(?<![A-Za-zÄÖÜäöüß])(du|dein|deine|deinen|deinem|deiner|deines|dich|dir)(?![A-Za-zÄÖÜäöüß])/iu;
// 2sg imperative at start. Do NOT match Sie-imperative "Schließen Sie" or the
// infinitive UI label "Schließen" (ß is not a JS \w, so Schließ\b false-positives).
const bareImp = /^(Sieh|Nimm|Geh|Komm|Mach|Schau|Sag|Gib|Lass|Denk|Bleib|Warte|Hol|Probier|Melde)(?![A-Za-zÄÖÜäöüß])/;
const schliessDich = /schließ(?:e)? dich/i;
const allow = (key) => key.startsWith('static.reviews.');

const hits = [];
for (const [group, path] of files) {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const leaves = [];
  walk(doc, '', leaves);
  for (const [key, val] of leaves) {
    if (allow(key)) continue;
    const m = val.match(pronoun);
    if (m) hits.push(`${group}\t${key}\tpronoun=${m[1]}\t${val.slice(0, 80)}`);
    else if (schliessDich.test(val) || bareImp.test(val.trim())) hits.push(`${group}\t${key}\timperative\t${val.slice(0, 80)}`);
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
  print_error "DE Sie-Form FAILED — du/dein/dich/dir or 2sg imperative leak:"
  echo ""
  echo "$REPORT"
  echo ""
  echo "Fix: rewrite to Sie. Exception: quoted testimonials under static.reviews.*."
  exit 1
elif [[ "$STATUS" -ne 0 ]]; then
  print_error "copy-de-sie scanner crashed (exit ${STATUS})"
  echo "$REPORT"
  exit 1
fi
print_success "German copy is Sie-Form (reviews quotes exempt)"
exit 0
