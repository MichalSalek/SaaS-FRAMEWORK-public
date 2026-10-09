#!/usr/bin/env npx tsx
/**
 * i18n Dead Key Detector
 *
 * Scans main/src/locales/pl/common.json + events.json for translation keys and
 * classifies every one of them into exactly ONE of three buckets:
 *
 *   LIVE        — a static reference was found (literal key, propagated
 *                 namespace, or a runtime key registry that IS the SSOT).
 *   UNVERIFIED  — the key can only be reached through a call whose argument is
 *                 not statically knowable (t(someVar), t(`p.${x}`), t(MAP[k])).
 *                 The detector says "I do not know", it does NOT say "dead".
 *   DEAD        — no reference of any kind. Safe to delete after a grep.
 *
 * DECISION (nie usuwaj tego komentarza) -- 2026-09-10:
 * Trzeci kubelek ISTNIEJE PO TO, ZEBY DETEKTOR BYL UZYWALNY. Poprzednia wersja
 * miala dwa stany (used / dead) i wszystko, czego nie umiala rozwiazac, ladowalo
 * w „dead" — 418 zgloszen, z czego ~30 prawdziwych. Detektor, ktory krzyczy
 * „wilk" w 90% przypadkow, jest gorszy niz brak detektora, bo czystka copy na
 * jego podstawie kasuje zywe klucze. Detektor, ktory mowi „nie wiem", jest
 * uzywalny. NIE scalaj UNVERIFIED z DEAD ani z LIVE.
 *
 * Resolution strategies (each is a separate, testable mechanism):
 *   1. Direct namespace     — const t = useTranslations('ns'); t('key')
 *   2. Typed namespace      — t: ReturnType<typeof useTranslations<'ns'>> and
 *                             type aliases resolving to it (OnboardingT, TFn…)
 *   3. Namespace PROPAGATION across files — a `t` created in file A and passed
 *      into file B (prop / argument) with an opaque type ((key: string) => string,
 *      ReturnType<typeof useTranslations> without a generic). The namespace is
 *      inherited from every file that imports B, to a fixpoint over the import
 *      graph. This is the single biggest source of old false positives.
 *   4. In-file key literals — a file that calls t(SOME_MAP[x]) usually holds the
 *      relative keys as plain literals ('categoryStyle'); those resolve exactly
 *      under the file's namespaces.
 *   5. Full-path literals   — 'validation.email.invalid' anywhere in the source
 *      is a reference by name (kernel VALIDATION_MESSAGES = the SSOT read at
 *      runtime from backend error tokens).
 *   6. Runtime key registries — namespaces whose keys are NEVER written in the
 *      frontend because they arrive from the backend (events.* ← APP_EVENTS).
 *   7. Template families    — t(`prefix.${x}`) and `${PREFIX_CONST}suffix`; const
 *      string variables are substituted before giving up.
 *
 * Usage:
 *   npm run i18n:detect-dead            summary + first 50 of each bucket
 *   npm run i18n:detect-dead -- --all   full lists
 *   npm run i18n:detect-dead -- --json  machine-readable (for codemods)
 *
 * NOTE: This script lists keys — it NEVER deletes them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// ============================================================
// Paths / CLI
// ============================================================

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOCALES_PL = path.join(ROOT, 'main/src/locales/pl');
const COMMON_JSON = path.join(LOCALES_PL, 'common.json');
const EVENTS_JSON = path.join(LOCALES_PL, 'events.json');
const SRC_DIR = path.join(ROOT, 'main/src');
const KERNEL_DIR = path.join(SRC_DIR, 'READONLY-shared-kernel');

const ARGV = process.argv.slice(2);
const SHOW_ALL = ARGV.includes('--all');
const AS_JSON = ARGV.includes('--json');

// ============================================================
// Types
// ============================================================

/**
 * How strongly a key is referenced. Order matters — a key keeps its STRONGEST
 * evidence, and only `wildcard` alone lands in the UNVERIFIED bucket.
 */
type Evidence = 'static' | 'propagated' | 'registry' | 'wildcard';

const EVIDENCE_RANK: Record<Evidence, number> = {
  static: 3,
  propagated: 2,
  registry: 1,
  wildcard: 0,
};

interface UnresolvedCall {
  file: string;
  line: number;
  detail: string;
}

interface AnalysisResult {
  totalKeys: number;
  evidence: Map<string, Evidence>;
  liveKeys: string[];
  unverifiedKeys: string[];
  deadKeys: string[];
  unresolvedCalls: UnresolvedCall[];
  /** Namespaces flooded by an opaque call — the reason keys land in UNVERIFIED. */
  opaqueNamespaces: Map<string, Set<string>>; // namespace -> files
  stats: {
    propagatedFiles: number;
    registryKeys: number;
    fullPathLiteralKeys: number;
  };
}

// ============================================================
// JSON flattening
// ============================================================

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const result: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result.push(...flattenKeys(value as Record<string, unknown>, fullKey));
    } else {
      result.push(fullKey);
    }
  }
  return result;
}

function loadAndFlatten(filePath: string, namespacePrefix?: string): string[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  // DECISION (nie usuwaj tego komentarza) -- 2026-09-10:
  // Kanarek na "inteligentne" cudzyslowy uzyte jako DELIMITERY JSON odpala sie
  // dopiero, gdy plik faktycznie sie nie parsuje. Wczesniej byla to heurystyka
  // regexowa szukajaca cudzyslowu obok znaku strukturalnego -- i dawala FALSZYWY
  // ALARM na poprawnej polskiej typografii wewnatrz wartosci: sekwencja `", "`
  // w zdaniu `"„Taki ksztalt”, „ten kolor na wesele”"` wyglada
  // dla regexu jak granica wartosci. Ostrzezenie brzmialo "FATAL parse risk. Use
  // ASCII double-quotes instead", wiec kolejny agent poszedlby POPRAWIC poprawne
  // copy, psujac je. Prawdziwy delimiter zawsze wywala `JSON.parse`, wiec to parse
  // jest orzeczeniem, a nie regex; cudzyslowy w TRESCI parsuja sie bez zarzutu.
  const smartQuoteRe = /[„“‟»«]/;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    if (smartQuoteRe.test(raw)) {
      console.error(
        `[FATAL] ${path.basename(filePath)} nie parsuje sie jako JSON, a zawiera "inteligentne" cudzyslowy -- sprawdz, czy ktorys nie stoi w miejscu ASCII " (delimiter klucza albo wartosci).`
      );
    }
    throw error;
  }
  return flattenKeys(parsed, namespacePrefix);
}

// ============================================================
// Namespace split analysis helpers
// ============================================================

function countSubtreeKeys(
  obj: Record<string, unknown>,
  prefix: string,
  depth: number,
  maxDepth: number,
  results: Map<string, number>
): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const sub = value as Record<string, unknown>;
      const count = countLeafKeys(sub);
      if (depth <= maxDepth) {
        results.set(fullKey, count);
      }
      if (depth < maxDepth) {
        countSubtreeKeys(sub, fullKey, depth + 1, maxDepth, results);
      }
    }
  }
}

function countLeafKeys(obj: Record<string, unknown>): number {
  let count = 0;
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      count += countLeafKeys(value as Record<string, unknown>);
    } else {
      count++;
    }
  }
  return count;
}

// ============================================================
// Source file discovery
// ============================================================

function findSourceFiles(): string[] {
  try {
    const output = execSync(
      `find "${SRC_DIR}" -type f \\( -name "*.ts" -o -name "*.tsx" \\) ! -path "*/node_modules/*" ! -path "*/.next/*" ! -path "*/dist/*"`,
      { encoding: 'utf-8' }
    );
    return output.trim().split('\n').filter(Boolean).sort();
  } catch {
    return walkDir(SRC_DIR).sort();
  }
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.next' ||
      entry.name === 'dist'
    )
      continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// ============================================================
// Lexing: comment stripping (offset-preserving)
// ============================================================

const REGEX_PRECEDING = new Set([
  '',
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '^',
  '~',
]);

/**
 * Blanks out comments (keeping newlines, so line numbers survive) without
 * touching string/template/regex literals.
 *
 * DECISION (nie usuwaj tego komentarza): to NIE jest kosmetyka. Bez tego kroku
 * kazda sciezka kropkowa zacytowana w komentarzu (a ten repo ma ich setki w
 * blokach DECISION) liczy sie jako uzycie klucza — detektor sam sobie fabrykuje
 * dowod i „ozywia" martwe klucze. Odwrotnie tez: `//` w URL-u wewnatrz stringa
 * nie moze wyciac reszty linii.
 */
function stripComments(src: string): string {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  let prevSignificant = '';

  while (i < n) {
    const c = src[i];

    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }

    if (c === '/' && src[i + 1] === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      }
      continue;
    }

    if (c === '"' || c === "'") {
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === c || src[i] === '\n') {
          i++;
          break;
        }
        i++;
      }
      prevSignificant = c;
      continue;
    }

    if (c === '`') {
      i++;
      let depth = 0;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '$' && src[i + 1] === '{') {
          depth++;
          i += 2;
          continue;
        }
        if (depth > 0 && src[i] === '}') {
          depth--;
          i++;
          continue;
        }
        if (depth === 0 && src[i] === '`') {
          i++;
          break;
        }
        i++;
      }
      prevSignificant = '`';
      continue;
    }

    if (c === '/' && REGEX_PRECEDING.has(prevSignificant)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '\n') break;
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) {
          closed = true;
          j++;
          break;
        }
        j++;
      }
      if (closed) {
        i = j;
        prevSignificant = '/';
        continue;
      }
    }

    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }

  return out.join('');
}

// ============================================================
// Lexing: balanced call-argument reader
// ============================================================

/**
 * Reads the first argument of a call whose `(` sits at `open`, respecting
 * nesting and literals. Returns the raw source of arg #0, or null.
 *
 * DECISION (nie usuwaj tego komentarza): to zastapilo regexy typu
 * `t\(\s*([A-Za-z_][\w.]*)\s*[,)]`. Tamte przepuszczaly `t(MAP[key])`,
 * `t(tab.navKey ?? 'x')` i `t(cond ? a : b)` — czyli wlasnie te ksztalty, ktore
 * powoduja, ze klucz jest nieznany. Niezauwazone wywolanie dynamiczne = cala
 * przestrzen nazw raportowana jako martwa.
 */
function readFirstArg(src: string, open: number): string | null {
  let i = open + 1;
  const n = src.length;
  let depth = 0;
  const start = i;

  while (i < n) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === ')' && depth === 0) return src.slice(start, i).trim();
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      i++;
      continue;
    }
    if (c === ',' && depth === 0) return src.slice(start, i).trim();
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '`') {
      i++;
      let tDepth = 0;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '$' && src[i + 1] === '{') {
          tDepth++;
          i += 2;
          continue;
        }
        if (tDepth > 0 && src[i] === '}') {
          tDepth--;
          i++;
          continue;
        }
        if (tDepth === 0 && src[i] === '`') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return null;
}

// ============================================================
// Per-file model
// ============================================================

interface TCall {
  varName: string;
  /** raw source of argument #0 — classified later by normalizeArgShape() */
  raw: string;
  line: number;
}

interface FileModel {
  file: string;
  code: string;
  /** translator variable -> namespace ('' = root). */
  knownVars: Map<string, string>;
  /** translator variables whose namespace must come from callers. */
  opaqueVars: Set<string>;
  calls: TCall[];
  /** every plain string literal in the file (comments already stripped) */
  literals: Set<string>;
  /** const NAME = 'literal' — used to expand template prefixes */
  constStrings: Map<string, string>;
  /** local module specifiers this file imports (absolute, extension-less) */
  imports: string[];
}

const RE_STRING_LITERAL = /(['"])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
const RE_IDENT_CALL =
  /\b([A-Za-z_$][\w$]*)\s*(?:\.\s*(?:raw|rich|markup|has))?\s*\(/g;

function lineAt(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < code.length; i++) {
    if (code[i] === '\n') line++;
  }
  return line;
}

/** Namespaces declared through a type alias, collected repo-wide first. */
interface AliasRegistry {
  known: Map<string, string>; // alias name -> namespace
  opaque: Set<string>; // alias name -> namespace unknown, inherit from callers
}

const RE_ALIAS_TYPED =
  /\btype\s+([A-Za-z_$][\w$]*)\s*=\s*ReturnType\s*<\s*typeof\s+useTranslations\s*<\s*['"]([^'"]*)['"]\s*>\s*>/g;
const RE_ALIAS_OPAQUE_RETURNTYPE =
  /\btype\s+([A-Za-z_$][\w$]*)\s*=\s*ReturnType\s*<\s*typeof\s+useTranslations\s*>/g;
// A hand-rolled translator alias: `type PayTranslateFn = (key: string) => string`.
// Gated on the NAME containing "translat" so unrelated `(key: string) => string`
// helpers (formatters, comparators) do not silently become translators.
const RE_ALIAS_OPAQUE_FN =
  /\btype\s+([A-Za-z_$]*[Tt]ranslat[\w$]*)\s*=\s*\(\s*\w+\s*:\s*string[^)]*\)\s*=>\s*string/g;

function collectAliases(codes: Map<string, string>): AliasRegistry {
  const known = new Map<string, string>();
  const opaque = new Set<string>();
  for (const code of codes.values()) {
    let m: RegExpExecArray | null;
    RE_ALIAS_TYPED.lastIndex = 0;
    while ((m = RE_ALIAS_TYPED.exec(code)) !== null) known.set(m[1], m[2]);
    RE_ALIAS_OPAQUE_RETURNTYPE.lastIndex = 0;
    while ((m = RE_ALIAS_OPAQUE_RETURNTYPE.exec(code)) !== null)
      if (!known.has(m[1])) opaque.add(m[1]);
    RE_ALIAS_OPAQUE_FN.lastIndex = 0;
    while ((m = RE_ALIAS_OPAQUE_FN.exec(code)) !== null)
      if (!known.has(m[1])) opaque.add(m[1]);
  }
  return { known, opaque };
}

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@kernel/')) {
    base = path.join(KERNEL_DIR, spec.slice('@kernel/'.length));
  } else if (spec.startsWith('./') || spec.startsWith('../')) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null;
  }
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  return fs.existsSync(base) && fs.statSync(base).isFile() ? base : null;
}

function buildFileModel(
  file: string,
  code: string,
  aliases: AliasRegistry
): FileModel {
  const knownVars = new Map<string, string>();
  const opaqueVars = new Set<string>();
  const literals = new Set<string>();
  const constStrings = new Map<string, string>();
  const imports: string[] = [];
  let m: RegExpExecArray | null;

  // ── string literals + const string bindings ─────────────────────────────
  RE_STRING_LITERAL.lastIndex = 0;
  while ((m = RE_STRING_LITERAL.exec(code)) !== null) literals.add(m[2]);

  const reConstString =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*(['"])((?:(?!\2)[^\\\n])*)\2/g;
  while ((m = reConstString.exec(code)) !== null) constStrings.set(m[1], m[3]);

  // ── imports (local modules only) ────────────────────────────────────────
  const reImport = /\bfrom\s*(['"])([^'"]+)\1/g;
  while ((m = reImport.exec(code)) !== null) {
    const resolved = resolveImport(file, m[2]);
    if (resolved) imports.push(resolved);
  }

  // ── 1. direct useTranslations() bindings ────────────────────────────────
  const reDeclare =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*useTranslations\s*(?:<[^>]*>)?\s*\(\s*(?:(['"])([^'"]*)\2)?\s*\)/g;
  while ((m = reDeclare.exec(code)) !== null) {
    knownVars.set(m[1], m[3] ?? '');
  }

  // ── 2. inline typed annotations: x: ReturnType<typeof useTranslations<'ns'>>
  const reInlineTyped =
    /\b([A-Za-z_$][\w$]*)\s*\??\s*:\s*ReturnType\s*<\s*typeof\s+useTranslations\s*<\s*['"]([^'"]*)['"]\s*>/g;
  while ((m = reInlineTyped.exec(code)) !== null) {
    if (!knownVars.has(m[1])) knownVars.set(m[1], m[2]);
  }

  // ── 3. inline OPAQUE annotations: x: ReturnType<typeof useTranslations>
  const reInlineOpaque =
    /\b([A-Za-z_$][\w$]*)\s*\??\s*:\s*ReturnType\s*<\s*typeof\s+useTranslations\s*>/g;
  while ((m = reInlineOpaque.exec(code)) !== null) {
    if (!knownVars.has(m[1])) opaqueVars.add(m[1]);
  }

  // ── 4. alias-typed annotations (OnboardingT, TPairing, DrawerTranslator…) ─
  const aliasNames = [...aliases.known.keys(), ...aliases.opaque];
  if (aliasNames.length > 0) {
    const reAliasUse = new RegExp(
      `\\b([A-Za-z_$][\\w$]*)\\s*\\??\\s*:\\s*(${aliasNames.map(escapeRe).join('|')})\\b`,
      'g'
    );
    while ((m = reAliasUse.exec(code)) !== null) {
      const [, varName, alias] = m;
      if (knownVars.has(varName)) continue;
      const ns = aliases.known.get(alias);
      if (ns !== undefined) knownVars.set(varName, ns);
      else opaqueVars.add(varName);
    }
  }

  // ── 5. wrapper translators: const t = useCallback(k => tRaw.raw(k), [tRaw])
  //    Restricted to t-shaped names so useMemo tables that merely *use* a
  //    translator are not mistaken for one.
  const reWrapper =
    /\b(?:const|let)\s+(t(?:[A-Z_][\w$]*)?)\s*(?::[^=;]{0,120})?=\s*([^;]{0,400})/g;
  while ((m = reWrapper.exec(code)) !== null) {
    const [, name, rhs] = m;
    if (knownVars.has(name) || !rhs.includes('=>')) continue;
    for (const [srcVar, ns] of knownVars) {
      if (
        srcVar !== name &&
        new RegExp(`\\b${escapeRe(srcVar)}\\b`).test(rhs)
      ) {
        knownVars.set(name, ns);
        break;
      }
    }
  }

  // ── 6. translator calls ─────────────────────────────────────────────────
  const translatorVars = new Set<string>([...knownVars.keys(), ...opaqueVars]);
  const calls: TCall[] = [];
  RE_IDENT_CALL.lastIndex = 0;
  while ((m = RE_IDENT_CALL.exec(code)) !== null) {
    const varName = m[1];
    if (!translatorVars.has(varName)) continue;
    const open = m.index + m[0].length - 1;
    const arg = readFirstArg(code, open);
    if (arg === null || arg === '' || isParameterDeclaration(arg)) continue;
    calls.push({ varName, raw: arg, line: lineAt(code, m.index) });
  }

  // ── 7. resolveMsgKey(messages, 'full.key') — the SECOND i18n consumer ────
  // DECISION (nie usuwaj tego komentarza): ten helper materializuje payloady
  // SEO/JSON-LD/meta w getStaticProps i bierze klucz PELNY (od korzenia), bez
  // namespace'u useTranslations. Koszt luki (S98): fala czystki uznala
  // `seo.about.jsonLd.event{1..5}{Name,Description}` za osierocone i skasowala
  // 10 kluczy x 3 jezyki. `resolveMsgKey` zwraca KLUCZ jako fallback, wiec nic
  // nie wybuchlo: /about zaczela emitowac do crawlerow piec obiektow
  // schema.org/Event z `name` rownym doslownej sciezce kropkowej. Build zielony.
  const reResolveMsgKey = /\bresolveMsgKey\s*\(/g;
  while ((m = reResolveMsgKey.exec(code)) !== null) {
    const open = m.index + m[0].length - 1;
    // skip arg #0 (the messages object), read arg #1
    const firstEnd = findArgEnd(code, open);
    if (firstEnd === null) continue;
    const arg = readFirstArg(code, firstEnd);
    if (arg === null || arg === '' || isParameterDeclaration(arg)) continue;
    calls.push({ varName: '$root', raw: arg, line: lineAt(code, m.index) });
  }
  if (calls.some(c => c.varName === '$root')) knownVars.set('$root', '');

  return {
    file,
    code,
    knownVars,
    opaqueVars,
    calls,
    literals,
    constStrings,
    imports,
  };
}

/** Index of the comma that ends argument #0 (so arg #1 can be read from it). */
function findArgEnd(src: string, open: number): number | null {
  let i = open + 1;
  const n = src.length;
  let depth = 0;
  while (i < n) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' && depth === 0) return null;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) return i;
    else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === quote) break;
        i++;
      }
    }
    i++;
  }
  return null;
}

/**
 * `resolveMsgKey(messages, key: string)` in resolve-msg-key.ts is the FUNCTION
 * DEFINITION, not a call. Without this guard the detector reports the helper's
 * own signature as an unresolved dynamic key on every run.
 */
function isParameterDeclaration(arg: string): boolean {
  return /^[A-Za-z_$][\w$]*\s*\??\s*:\s*[A-Za-z_$]/.test(arg);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// Namespace propagation over the import graph
// ============================================================

/**
 * A file that receives `t` as a prop/argument has no namespace of its own.
 * The namespace lives in whichever file CREATED that `t` — usually the sibling
 * `*.composition.tsx` that renders the `*.parts.*`. We therefore inherit, to a
 * fixpoint, the namespaces of every file that imports us.
 *
 * DECISION (nie usuwaj tego komentarza): to jest naprawa najwiekszej klasy
 * falszywych alarmow (~73 klucze: admin.support, pages.pairing, pages.onboarding,
 * account.pay, drawer/menu/nav przez AppDrawer). Kierunek jest ODWROTNY do
 * importu: dane (namespace) plyna od IMPORTUJACEGO do IMPORTOWANEGO, bo to
 * importujacy podaje `t` w propsie. Domykamy przechodnio, bo lancuch potrafi
 * miec trzy ogniwa (composition -> parts -> helpers).
 */
function propagateNamespaces(models: Map<string, FileModel>): {
  inherited: Map<string, Set<string>>;
  propagatedFiles: number;
} {
  const importers = new Map<string, Set<string>>();
  for (const model of models.values()) {
    for (const imported of model.imports) {
      if (!models.has(imported)) continue;
      if (!importers.has(imported)) importers.set(imported, new Set());
      importers.get(imported)!.add(model.file);
    }
  }

  const own = new Map<string, Set<string>>();
  for (const model of models.values()) {
    own.set(model.file, new Set(model.knownVars.values()));
  }

  const inherited = new Map<string, Set<string>>();
  for (const file of models.keys()) inherited.set(file, new Set());

  const MAX_ROUNDS = 12;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let changed = false;
    for (const model of models.values()) {
      if (model.opaqueVars.size === 0) continue;
      const target = inherited.get(model.file)!;
      for (const importer of importers.get(model.file) ?? []) {
        for (const ns of own.get(importer) ?? []) {
          if (!target.has(ns)) {
            target.add(ns);
            changed = true;
          }
        }
        for (const ns of inherited.get(importer) ?? []) {
          if (!target.has(ns)) {
            target.add(ns);
            changed = true;
          }
        }
      }
      // A file may both create and receive translators — its own namespaces are
      // candidates for its opaque vars too.
      for (const ns of own.get(model.file) ?? []) {
        if (!target.has(ns)) {
          target.add(ns);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  let propagatedFiles = 0;
  for (const [file, set] of inherited) {
    if (models.get(file)!.opaqueVars.size > 0 && set.size > 0)
      propagatedFiles++;
  }
  return { inherited, propagatedFiles };
}

// ============================================================
// Runtime key registries (keys never written in the frontend)
// ============================================================

/**
 * Namespaces resolved at RUNTIME from a backend token. The frontend never spells
 * the key; the kernel does, and the kernel IS the SSOT. Reading that SSOT is not
 * a heuristic — it is the same list next-intl will be handed at runtime.
 *
 *   validation.* — VALIDATION_MESSAGES values are already FULL paths, so the
 *                  generic full-path literal sweep covers them. Listed here for
 *                  the record and as a coverage assertion.
 *   events.*     — APP_EVENTS leaf values are BARE tokens ('ACCOUNT_CREATED'),
 *                  concatenated to `events.` only inside next-intl.
 */
const RUNTIME_REGISTRIES: ReadonlyArray<{
  namespace: string;
  sourceFile: string;
  mode: 'full-path' | 'leaf-token';
}> = [
  {
    namespace: 'validation',
    sourceFile: 'domain/i18n/validation.i18n.ts',
    mode: 'full-path',
  },
  {
    namespace: 'events',
    sourceFile: 'domain/events/app-events.const.ts',
    mode: 'leaf-token',
  },
];

function collectRegistryKeys(): Set<string> {
  const out = new Set<string>();
  for (const reg of RUNTIME_REGISTRIES) {
    const abs = path.join(KERNEL_DIR, reg.sourceFile);
    if (!fs.existsSync(abs)) {
      console.warn(
        `[WARN] Rejestr runtime nie istnieje: ${path.relative(ROOT, abs)} — klucze ${reg.namespace}.* nie zostana rozwiazane.`
      );
      continue;
    }
    const code = stripComments(fs.readFileSync(abs, 'utf-8'));
    let m: RegExpExecArray | null;
    RE_STRING_LITERAL.lastIndex = 0;
    while ((m = RE_STRING_LITERAL.exec(code)) !== null) {
      const value = m[2];
      if (reg.mode === 'full-path') {
        if (value.startsWith(`${reg.namespace}.`)) out.add(value);
      } else if (/^[A-Z][A-Z0-9_]*$/.test(value)) {
        out.add(`${reg.namespace}.${value}`);
      }
    }
  }
  return out;
}

// ============================================================
// Main analysis
// ============================================================

function analyzeSource(
  sourceFiles: string[],
  allJsonKeys: Set<string>
): AnalysisResult {
  const evidence = new Map<string, Evidence>();
  const unresolvedCalls: UnresolvedCall[] = [];
  const opaqueNamespaces = new Map<string, Set<string>>();

  const mark = (key: string, level: Evidence): void => {
    if (!allJsonKeys.has(key)) return;
    const current = evidence.get(key);
    if (
      current === undefined ||
      EVIDENCE_RANK[level] > EVIDENCE_RANK[current]
    ) {
      evidence.set(key, level);
    }
  };

  // Prefix index — turns "mark the whole namespace" from an O(all keys) scan
  // into a bounded lookup.
  const allKeysList = [...allJsonKeys];
  const keysByPrefix = new Map<string, string[]>();
  for (const key of allJsonKeys) {
    const parts = key.split('.');
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('.');
      if (!keysByPrefix.has(prefix)) keysByPrefix.set(prefix, []);
      keysByPrefix.get(prefix)!.push(key);
    }
  }
  const markFamily = (prefix: string, level: Evidence): number => {
    const hits = keysByPrefix.get(prefix) ?? [];
    for (const key of hits) mark(key, level);
    return hits.length;
  };

  // 1. Read + strip every source file once.
  const codes = new Map<string, string>();
  for (const file of sourceFiles) {
    codes.set(file, stripComments(fs.readFileSync(file, 'utf-8')));
  }

  // 2. Repo-wide type-alias registry, then per-file models.
  const aliases = collectAliases(codes);
  const models = new Map<string, FileModel>();
  for (const [file, code] of codes) {
    models.set(file, buildFileModel(file, code, aliases));
  }

  // 3. Namespace propagation across the import graph.
  const { inherited, propagatedFiles } = propagateNamespaces(models);

  // 4. Runtime registries (validation.*, events.*).
  const registryKeys = collectRegistryKeys();
  let registryHits = 0;
  for (const key of registryKeys) {
    if (allJsonKeys.has(key)) {
      mark(key, 'registry');
      registryHits++;
    }
  }

  // 5. Full-path string literals anywhere in the source = a reference by name.
  let fullPathLiteralKeys = 0;
  for (const model of models.values()) {
    for (const literal of model.literals) {
      if (!literal.includes('.')) continue;
      if (allJsonKeys.has(literal)) {
        if (!evidence.has(literal)) fullPathLiteralKeys++;
        mark(literal, 'static');
      }
    }
  }

  // 6. Translator calls.
  //
  // DECISION (nie usuwaj tego komentarza): pula literalow siega o JEDEN import
  // dalej niz plik wywolujacy. Wzorzec „dane osobno, render osobno" jest w tym
  // repo regula (`ComparePageData.ts` trzyma `{ labelKey: 'x' }`, a
  // `ComparePage.composition.tsx` robi `t(row.labelKey)`), wiec bez tego kroku
  // KAZDY taki namespace szedl w calosci do „nie wiem" i raport tonal w szumie.
  const literalPoolCache = new Map<string, Set<string>>();
  const literalPool = (model: FileModel): Set<string> => {
    const cached = literalPoolCache.get(model.file);
    if (cached) return cached;
    const pool = new Set<string>(model.literals);
    for (const imported of model.imports) {
      const dep = models.get(imported);
      if (!dep) continue;
      for (const literal of dep.literals) pool.add(literal);
    }
    literalPoolCache.set(model.file, pool);
    return pool;
  };

  for (const model of models.values()) {
    const relFile = path.relative(ROOT, model.file);
    const inheritedNs = inherited.get(model.file) ?? new Set<string>();

    const namespacesFor = (
      varName: string
    ): {
      list: string[];
      propagated: boolean;
    } => {
      const known = model.knownVars.get(varName);
      if (known !== undefined) return { list: [known], propagated: false };
      return { list: [...inheritedNs], propagated: true };
    };

    const join = (ns: string, rel: string): string =>
      ns ? `${ns}.${rel}` : rel;

    for (const call of model.calls) {
      const { list, propagated } = namespacesFor(call.varName);
      const level: Evidence = propagated ? 'propagated' : 'static';
      const shape = normalizeArgShape(call.raw, model.constStrings);

      // ── exact key (literal, or a template/concat fully resolved by consts) ──
      if (shape !== null && 'exact' in shape) {
        const hits = list
          .map(ns => join(ns, shape.exact))
          .filter(k => allJsonKeys.has(k));
        if (hits.length > 0) {
          for (const key of hits) mark(key, level);
          continue;
        }
        // No namespace candidate produces an existing key — the call site is
        // real but unattributable. Report it instead of silently dropping it.
        unresolvedCalls.push({
          file: relFile,
          line: call.line,
          detail: `${call.varName}('${shape.exact}') — brak pasujacego klucza (kandydaci namespace: ${list.length ? list.map(n => n || '<root>').join(', ') : 'brak'})`,
        });
        continue;
      }

      // ── computed key FAMILY (`feature${n}`, `status_${s}`, prefix + x) ──────
      if (shape !== null) {
        let matched = 0;
        for (const ns of list) {
          const hits = keysMatchingPattern(
            join(ns, shape.pattern),
            allKeysList
          );
          for (const key of hits) mark(key, 'wildcard');
          if (hits.length > 0) {
            matched += hits.length;
            const family = commonPrefixOf(hits);
            if (!opaqueNamespaces.has(family))
              opaqueNamespaces.set(family, new Set());
            opaqueNamespaces
              .get(family)!
              .add(`${relFile}:${call.line} → ${truncate(call.raw)}`);
          }
        }
        if (matched === 0) {
          unresolvedCalls.push({
            file: relFile,
            line: call.line,
            detail: `${call.varName}(${truncate(call.raw)}) — rodzina kluczy bez dopasowania`,
          });
        }
        continue;
      }

      // ── fully opaque argument: t(someVar), t(MAP[x]), t(cond ? a : b) ───────
      // Step 1 — the relative key almost always sits as a plain literal either
      // in this file (TRAIT_CATEGORY_LABEL_KEY) or in the data module this file
      // imports (`{ labelKey: 'compareRowBooking' }` in *PageData.ts). Resolve
      // those exactly; only the REMAINDER of the namespace is unknowable.
      for (const ns of list) {
        for (const literal of literalPool(model)) {
          const key = join(ns, literal);
          if (allJsonKeys.has(key)) mark(key, level);
        }
      }
      // Step 2 — whatever is left in that namespace is genuinely unknowable.
      for (const ns of list) {
        if (ns === '') {
          // Root namespace: flooding EVERY key would erase the whole report, so
          // the call goes to the unresolved list for a human instead.
          unresolvedCalls.push({
            file: relFile,
            line: call.line,
            detail: `${call.varName}(${truncate(call.raw)}) — namespace glowny, klucz dynamiczny`,
          });
          continue;
        }
        const size = markFamily(ns, 'wildcard');
        if (size > 0) {
          if (!opaqueNamespaces.has(ns)) opaqueNamespaces.set(ns, new Set());
          opaqueNamespaces
            .get(ns)!
            .add(`${relFile}:${call.line} → ${truncate(call.raw)}`);
        }
      }
    }
  }

  const liveKeys: string[] = [];
  const unverifiedKeys: string[] = [];
  const deadKeys: string[] = [];
  for (const key of [...allJsonKeys].sort()) {
    const level = evidence.get(key);
    if (level === undefined) deadKeys.push(key);
    else if (level === 'wildcard') unverifiedKeys.push(key);
    else liveKeys.push(key);
  }

  return {
    totalKeys: allJsonKeys.size,
    evidence,
    liveKeys,
    unverifiedKeys,
    deadKeys,
    unresolvedCalls,
    opaqueNamespaces,
    stats: {
      propagatedFiles,
      registryKeys: registryHits,
      fullPathLiteralKeys,
    },
  };
}

// ============================================================
// Key-shape resolution: literal / template / concatenation
// ============================================================

const HOLE = '\u0000';

/**
 * Reduces a call argument to a KEY SHAPE: either an exact relative key, or a
 * pattern with `\0` standing for "something computed here".
 *
 * DECISION (nie usuwaj tego komentarza): trzy ksztalty sa w tym repo rownowazne
 * i wszystkie trzy musza dzialac, bo kazdy z nich juz raz kosztowal skasowanie
 * zywych kluczy albo szum w raporcie:
 *   t(`seo.home.jsonLd.feature${n}`)      — szablon z podstawieniem W SRODKU
 *   t(prefix + 'how.headline')            — sklejka `+` (JSON-LD w getStaticProps)
 *   t(`${PREFIX}chrome`)                  — szablon z prefiksem w stalej
 * Zwykly „prefiks do pierwszego ${" nie wystarcza: dla `event${i}Name` prefiks
 * konczy sie na `event`, ktory NIE jest segmentem kropkowym, wiec rodzina nie
 * miala zadnego dopasowania i dziesiec zywych kluczy ladowalo w „martwych"
 * (dokladnie incydent S98).
 */
function normalizeArgShape(
  arg: string,
  constStrings: Map<string, string>
): { exact: string } | { pattern: string } | null {
  const literal = /^(['"])((?:(?!\1)[^\\\n]|\\.)*)\1$/.exec(arg);
  if (literal) return { exact: literal[2] };

  if (arg.startsWith('`') && arg.endsWith('`')) {
    const body = arg.slice(1, -1);
    const filled = body.replace(
      /\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g,
      (whole, name: string) => constStrings.get(name) ?? whole
    );
    const pattern = filled.replace(/\$\{[^}]*\}/g, HOLE);
    return pattern.includes(HOLE) ? { pattern } : { exact: pattern };
  }

  // Concatenation: prefix + 'how.headline' + suffix
  if (arg.includes('+')) {
    const parts = splitTopLevelPlus(arg);
    if (parts.length > 1) {
      let known = false;
      const pieces = parts.map(part => {
        const lit = /^(['"])((?:(?!\1)[^\\\n]|\\.)*)\1$/.exec(part);
        if (lit) {
          known = true;
          return lit[2];
        }
        const constant = constStrings.get(part);
        if (constant !== undefined) {
          known = true;
          return constant;
        }
        return HOLE;
      });
      if (known) {
        const pattern = pieces.join('');
        return pattern.includes(HOLE) ? { pattern } : { exact: pattern };
      }
    }
  }

  return null;
}

function splitTopLevelPlus(arg: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < arg.length; i++) {
    const c = arg[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < arg.length) {
        if (arg[i] === '\\') {
          i += 2;
          continue;
        }
        if (arg[i] === quote) break;
        i++;
      }
    } else if (c === '+' && depth === 0 && arg[i + 1] !== '+') {
      parts.push(arg.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(arg.slice(start).trim());
  return parts.filter(Boolean);
}

/** Keys matching a `\0`-holed pattern. Tries dot-tight first, then permissive. */
function keysMatchingPattern(
  pattern: string,
  allKeys: readonly string[]
): string[] {
  for (const hole of ['[^.]*', '.*']) {
    const source = '^' + pattern.split(HOLE).map(escapeRe).join(hole) + '$';
    const re = new RegExp(source);
    const hits = allKeys.filter(k => re.test(k));
    if (hits.length > 0) return hits;
  }
  return [];
}

/** Longest dot-segment prefix shared by a set of keys (label for a family). */
function commonPrefixOf(keys: readonly string[]): string {
  if (keys.length === 0) return '';
  let parts = keys[0].split('.');
  for (const key of keys.slice(1)) {
    const other = key.split('.');
    let i = 0;
    while (i < parts.length && i < other.length && parts[i] === other[i]) i++;
    parts = parts.slice(0, i);
    if (parts.length === 0) break;
  }
  return parts.join('.') || keys[0].split('.')[0];
}

function truncate(s: string, max = 60): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

// ============================================================
// Namespace split analysis (informational)
// ============================================================

function analyzeNamespaceSplitCandidates(): void {
  const raw = fs.readFileSync(COMMON_JSON, 'utf-8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const subtreeSizes = new Map<string, number>();
  countSubtreeKeys(parsed, '', 0, 1, subtreeSizes);

  const CANDIDATE_THRESHOLD = 50;
  const candidates = [...subtreeSizes.entries()]
    .filter(([, count]) => count >= CANDIDATE_THRESHOLD)
    .sort((a, b) => b[1] - a[1]);

  console.log('\n' + '─'.repeat(66));
  console.log('NAMESPACE SPLIT CANDIDATES (informational)');
  console.log('─'.repeat(66));
  console.log(
    `  Subtrees with ≥${CANDIDATE_THRESHOLD} keys — candidates for their own JSON namespace.\n`
  );

  if (candidates.length === 0) {
    console.log('  No candidates found.');
    return;
  }
  console.log(`  ${'Namespace'.padEnd(32)} ${'Keys'.padStart(6)}`);
  console.log('  ' + '─'.repeat(40));
  for (const [ns, count] of candidates.slice(0, 12)) {
    console.log(`  ${ns.padEnd(32)} ${String(count).padStart(6)}`);
  }
}

// ============================================================
// Entry point
// ============================================================

function main(): void {
  if (!fs.existsSync(COMMON_JSON)) {
    console.error(`ERROR: common.json not found at ${COMMON_JSON}`);
    process.exit(1);
  }
  if (!fs.existsSync(EVENTS_JSON)) {
    console.error(`ERROR: events.json not found at ${EVENTS_JSON}`);
    process.exit(1);
  }

  const commonKeys = loadAndFlatten(COMMON_JSON);
  const eventsKeys = loadAndFlatten(EVENTS_JSON, 'events');
  const allJsonKeys = new Set([...commonKeys, ...eventsKeys]);
  const sourceFiles = findSourceFiles();
  const result = analyzeSource(sourceFiles, allJsonKeys);

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        {
          total: result.totalKeys,
          live: result.liveKeys.length,
          unverified: result.unverifiedKeys,
          dead: result.deadKeys,
          unresolvedCalls: result.unresolvedCalls,
        },
        null,
        2
      )
    );
    process.exitCode = result.deadKeys.length > 0 ? 1 : 0;
    return;
  }

  console.log('═'.repeat(66));
  console.log('  i18n DEAD KEY DETECTOR');
  console.log('═'.repeat(66));
  console.log(`  common.json: ${commonKeys.length} keys`);
  console.log(`  events.json: ${eventsKeys.length} keys (namespace 'events')`);
  console.log(`  source:      ${sourceFiles.length} TS/TSX files in main/src/`);
  console.log();

  const LIMIT = SHOW_ALL ? Number.MAX_SAFE_INTEGER : 50;

  // ── DEAD ────────────────────────────────────────────────────────────────
  console.log('─'.repeat(66));
  console.log(`DEAD — no reference of any kind (${result.deadKeys.length})`);
  console.log('─'.repeat(66));
  if (result.deadKeys.length === 0) {
    console.log(
      '  Brak. Kazdy klucz ma dowod uzycia albo siedzi w NIEPEWNYCH.'
    );
  } else {
    result.deadKeys.slice(0, LIMIT).forEach((key, i) => {
      console.log(`  ${String(i + 1).padStart(4)}. ${key}`);
    });
    if (result.deadKeys.length > LIMIT) {
      console.log(
        `\n  … i ${result.deadKeys.length - LIMIT} wiecej (--all pokazuje wszystko)`
      );
    }
    console.log(
      '\n  Zanim skasujesz: `npm run copy:grep -- "<ostatni.segment>"` — detektor\n' +
        '  czyta tylko main/src, a klucz moze byc cytowany w dokumentacji lub w web-1.'
    );
  }

  // ── UNVERIFIED ──────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(66));
  console.log(
    `CANNOT VERIFY STATICALLY (${result.unverifiedKeys.length}) — „nie wiem", NIE „martwe"`
  );
  console.log('─'.repeat(66));
  if (result.unverifiedKeys.length === 0) {
    console.log('  Brak.');
  } else {
    console.log(
      '  Osiagalne wylacznie przez wywolanie z argumentem niestatycznym.\n' +
        '  Zrodla (namespace ← call site):\n'
    );
    const sorted = [...result.opaqueNamespaces.entries()]
      .map(
        ([ns, sites]) =>
          [
            ns,
            sites,
            result.unverifiedKeys.filter(
              k => k === ns || k.startsWith(`${ns}.`)
            ).length,
          ] as const
      )
      // A namespace whose every key was reclaimed by an exact literal is not a
      // finding — listing it with "0 kluczy" is pure noise.
      .filter(([, , count]) => count > 0)
      .sort((a, b) => b[2] - a[2]);
    for (const [ns, sites, count] of sorted.slice(0, SHOW_ALL ? 999 : 15)) {
      console.log(`    ${ns.padEnd(34)} ${String(count).padStart(4)} kluczy`);
      for (const site of [...sites].slice(0, SHOW_ALL ? 99 : 2)) {
        console.log(`      ← ${site}`);
      }
    }
    if (SHOW_ALL) {
      console.log('\n  Klucze:');
      result.unverifiedKeys.forEach(k => console.log(`    ${k}`));
    }
  }

  // ── unresolved call sites ───────────────────────────────────────────────
  if (result.unresolvedCalls.length > 0) {
    console.log('\n' + '─'.repeat(66));
    console.log(
      `UNRESOLVED CALL SITES (${result.unresolvedCalls.length}) — wywolanie bez dopasowanego klucza`
    );
    console.log('─'.repeat(66));
    for (const c of result.unresolvedCalls.slice(0, SHOW_ALL ? 9999 : 20)) {
      console.log(`  ${c.file}:${c.line}`);
      console.log(`    ${c.detail}`);
    }
    if (!SHOW_ALL && result.unresolvedCalls.length > 20) {
      console.log(`  … i ${result.unresolvedCalls.length - 20} wiecej`);
    }
  }

  // ── SUMMARY ─────────────────────────────────────────────────────────────
  const { liveKeys, unverifiedKeys, deadKeys, totalKeys } = result;
  console.log('\n' + '═'.repeat(66));
  console.log('  SUMMARY');
  console.log('═'.repeat(66));
  console.log(`  Total keys:                 ${totalKeys}`);
  console.log(
    `  LIVE (statycznie dowiedzione): ${liveKeys.length}  (${((liveKeys.length / totalKeys) * 100).toFixed(1)}%)`
  );
  console.log(
    `  CANNOT VERIFY STATICALLY:      ${unverifiedKeys.length}  (${((unverifiedKeys.length / totalKeys) * 100).toFixed(1)}%)`
  );
  console.log(
    `  DEAD:                          ${deadKeys.length}  (${((deadKeys.length / totalKeys) * 100).toFixed(1)}%)`
  );
  console.log();
  console.log(
    `  Rozwiazane rejestrem runtime:      ${result.stats.registryKeys}`
  );
  console.log(
    `  Rozwiazane literalem pelnej sciezki: ${result.stats.fullPathLiteralKeys}`
  );
  console.log(
    `  Plikow z namespace'em z propagacji:  ${result.stats.propagatedFiles}`
  );

  analyzeNamespaceSplitCandidates();

  console.log('\n' + '═'.repeat(66));
  process.exitCode = deadKeys.length > 0 ? 1 : 0;
}

main();
