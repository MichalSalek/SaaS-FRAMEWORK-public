// Static map of which next-intl namespaces a page's component tree reads.
// Used by application/i18n/page-messages.test.ts (the safety net behind
// getPublicPageMessages). It follows every relative and `@kernel/` import
// (static, re-export and dynamic `import()`) from an entry file and records
// each `useTranslations(...)` argument.
//
// Over-approximation is deliberate: a file reached only through a dialog or a
// type import still counts, so a namespace is never judged unused while some
// path can render it. What it cannot see is reported, not guessed: a call
// without a namespace (`<root>`) or with an argument that is not a string
// literal or a known `*NAMESPACE*` constant (`<dynamic:...>`).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const SRC_ROOT = resolve(__dirname, '..');
const KERNEL_ROOT = join(SRC_ROOT, 'READONLY-shared-kernel');

const IMPORT_RE = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
const USE_TRANSLATIONS_RE = /\buseTranslations\(\s*([^)]*?)\s*\)/g;
const NAMESPACE_CONST_RE =
  /export const (\w*NAMESPACE\w*)\s*=\s*['"]([^'"]+)['"]/g;

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(path, out);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      out.push(path);
    }
  }
  return out;
}

let namespaceConstants: Map<string, string> | null = null;

/** `export const X_NAMESPACE = 'a.b'` anywhere under src/, by name. */
function getNamespaceConstants(): Map<string, string> {
  if (namespaceConstants) {
    return namespaceConstants;
  }
  const found = new Map<string, string>();
  for (const file of listSourceFiles(SRC_ROOT)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(NAMESPACE_CONST_RE)) {
      const [, name, value] = match;
      if (name !== undefined && value !== undefined) {
        found.set(name, value);
      }
    }
  }
  namespaceConstants = found;
  return found;
}

function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@kernel/')) {
    base = join(KERNEL_ROOT, specifier.slice('@kernel/'.length));
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null;
  }
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (
      /\.tsx?$/.test(candidate) &&
      existsSync(candidate) &&
      statSync(candidate).isFile()
    ) {
      return candidate;
    }
  }
  return null;
}

/** Strips comments so a commented-out call or import is not counted. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

export interface NamespaceUsage {
  /** Namespace → files (relative to src/) that read it. */
  readonly namespaces: ReadonlyMap<string, ReadonlySet<string>>;
  /** Calls the analysis cannot resolve to a namespace. */
  readonly unresolved: ReadonlyMap<string, ReadonlySet<string>>;
  readonly fileCount: number;
}

export function collectNamespaceUsage(
  entryFiles: readonly string[]
): NamespaceUsage {
  const constants = getNamespaceConstants();
  const seen = new Set<string>();
  const namespaces = new Map<string, Set<string>>();
  const unresolved = new Map<string, Set<string>>();
  const stack = [...entryFiles];
  const record = (
    target: Map<string, Set<string>>,
    key: string,
    file: string
  ) => {
    const files = target.get(key) ?? new Set<string>();
    files.add(relative(SRC_ROOT, file));
    target.set(key, files);
  };

  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || seen.has(file)) {
      continue;
    }
    seen.add(file);
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const match of text.matchAll(IMPORT_RE)) {
      const specifier = match[1];
      const target =
        specifier === undefined ? null : resolveImport(file, specifier);
      if (target !== null && !/\.test\.tsx?$/.test(target)) {
        stack.push(target);
      }
    }
    for (const match of text.matchAll(USE_TRANSLATIONS_RE)) {
      const argument = (match[1] ?? '').trim();
      const literal = /^(['"])([^'"]+)\1$/.exec(argument);
      if (literal?.[2] !== undefined) {
        record(namespaces, literal[2], file);
      } else if (constants.has(argument)) {
        record(namespaces, constants.get(argument) ?? argument, file);
      } else {
        record(
          unresolved,
          argument === '' ? '<root>' : `<dynamic:${argument}>`,
          file
        );
      }
    }
  }

  return { namespaces, unresolved, fileCount: seen.size };
}

/** `a.b.c` is served by a picked `a`, `a.b` or `a.b.c`. */
export function isNamespaceCovered(
  used: string,
  loaded: readonly string[]
): boolean {
  return loaded.some(entry => used === entry || used.startsWith(`${entry}.`));
}

/** A picked entry is read when some call reads it, a parent or a child. */
export function isNamespaceRead(
  entry: string,
  used: Iterable<string>
): boolean {
  for (const namespace of used) {
    if (
      namespace === entry ||
      namespace.startsWith(`${entry}.`) ||
      entry.startsWith(`${namespace}.`)
    ) {
      return true;
    }
  }
  return false;
}
