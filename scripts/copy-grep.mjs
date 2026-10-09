#!/usr/bin/env node
/**
 * copy:grep — przeszukuje WSZYSTKIE powierzchnie copy projektu jednym ruchem.
 *
 * Użycie:  npm run copy:grep -- "wzorzec"            (regex, case-insensitive)
 *          npm run copy:grep -- "offline|desktop"
 *
 * Po co: copy żyje w 9 plikach i18n ORAZ w powierzchniach niewidocznych dla
 * zwykłego sweepu po common.json (e-maile w kernelu, llms.txt, JSON-LD, meta
 * w pages/, inline e-maile web-1). Zmiana faktu produktowego (cena, limit,
 * mechanika trialu, istnienie funkcji) = obowiązkowy przebieg tego skryptu,
 * inaczej fakt gnije w powierzchni, której nikt nie czyta (lekcja sesji copy
 * 2026-06-10: "zmień hasło" w mailu, "do 5 stylistek", "Działa offline").
 */
import fs from 'node:fs';
import path from 'node:path';

const pattern = process.argv[2];
if (!pattern) {
  console.error('Użycie: npm run copy:grep -- "wzorzec-regex"');
  process.exit(1);
}
const re = new RegExp(pattern, 'i');
const root = path.resolve(import.meta.dirname, '..');

const JSON_SURFACES = [
  'main/src/locales/pl/common.json',
  'main/src/locales/en/common.json',
  'main/src/locales/de/common.json',
  'main/src/locales/pl/events.json',
  'main/src/locales/en/events.json',
  'main/src/locales/de/events.json',
  '.shared-kernel/domain/email/locales/email-i18n.pl.json',
  '.shared-kernel/domain/email/locales/email-i18n.en.json',
  '.shared-kernel/domain/email/locales/email-i18n.de.json',
];
const TEXT_SURFACES = [
  'main/public/llms-pl.txt',
  'main/public/llms.txt',
  'main/public/llms-de.txt',
  'web-1/src/domain/support/support-email.service.ts',
  'web-1/src/domain/moderation/moderation-email.service.ts',
];

const flatten = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? prefix + '.' + k : k;
    if (typeof v === 'string') out[p] = v;
    else if (v && typeof v === 'object') flatten(v, p, out);
  }
  return out;
};

const collectFiles = (dir, predicate, acc = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, predicate, acc);
    else if (predicate(entry.name)) acc.push(full);
  }
  return acc;
};

let total = 0;

for (const rel of JSON_SURFACES) {
  const flat = flatten(JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')));
  const hits = Object.entries(flat).filter(([, v]) => re.test(v));
  if (hits.length) {
    console.log('\n## ' + rel + ' (' + hits.length + ')');
    for (const [k, v] of hits) console.log('  ' + k + ' = ' + JSON.stringify(v.length > 160 ? v.slice(0, 160) + '…' : v));
    total += hits.length;
  }
}

// JSON-LD + SEO-meta w pages/ (hardcoded copy poza i18n)
const tsSurfaces = [
  ...collectFiles(path.join(root, 'main/src/UI'), (n) => /JsonLd.*\.ts$/.test(n)),
  ...collectFiles(path.join(root, 'main/src/pages'), (n) => n.endsWith('.tsx') || n.endsWith('.ts')),
];

for (const rel of [...TEXT_SURFACES.map((r) => path.join(root, r)), ...tsSurfaces]) {
  let raw;
  try { raw = fs.readFileSync(rel, 'utf8'); } catch { continue; }
  const hits = raw.split('\n').map((l, i) => (re.test(l) ? i + 1 + ': ' + l.trim().slice(0, 160) : null)).filter(Boolean);
  if (hits.length) {
    console.log('\n## ' + path.relative(root, rel) + ' (' + hits.length + ')');
    hits.forEach((h) => console.log('  ' + h));
    total += hits.length;
  }
}

console.log('\n=== RAZEM: ' + total + ' trafień dla /' + pattern + '/i ===');
