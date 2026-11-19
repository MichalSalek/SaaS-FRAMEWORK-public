/**
 * Pure parts of the contract-registry generator (no file system, no kernel import), so they are
 * testable on strings: `registry-regions.test.ts`.
 */

const OPEN = /^(\s*)\/\/ <generated:contracts:([^>]+)>.*$/;

const MANUAL_OPEN = '// <contracts:manual>';
const MANUAL_CLOSE = '// </contracts:manual>';

/**
 * The hand-written prefix of a generated DTO file: shared types and re-exports that are not the
 * `<DOMAIN>_DTO_API_V1` view. Absent when the file is only that view (favorites).
 */
export const extractContractManual = (source: string): string | null => {
  const start = source.indexOf(MANUAL_OPEN);
  const close = source.indexOf(MANUAL_CLOSE);
  if (start < 0 && close < 0) return null;
  if (
    start < 0 ||
    close < start ||
    source.indexOf(MANUAL_OPEN, start + MANUAL_OPEN.length) >= 0 ||
    source.indexOf(MANUAL_CLOSE, close + MANUAL_CLOSE.length) >= 0
  ) {
    throw new Error('Malformed contracts:manual markers');
  }
  const end = close;
  return source.slice(start, end + MANUAL_CLOSE.length);
};

/** Code part of a line: a `//` comment is prose, not an entry. */
const codeOf = (line: string): string => line.replace(/\/\/.*$/, '');

export type FillResult = { text: string; problems: string[] };

/**
 * Replaces every `generated:contracts:<id>` region of `source` with its generated lines.
 * Problems: a region without its closing marker, a region no contract field produces, a region a
 * contract needs that the file lacks, and any line OUTSIDE the regions whose code matches one of
 * `forbiddenOutside` (an entry that only the contract may produce, written by hand).
 */
export const fillRegions = (
  label: string,
  source: string,
  regions: ReadonlyMap<string, readonly string[]>,
  forbiddenOutside: readonly RegExp[] = []
): FillResult => {
  const problems: string[] = [];
  const lines = source.split('\n');
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const open = OPEN.exec(line);
    if (open === null) {
      const code = codeOf(line);
      for (const pattern of forbiddenOutside) {
        const hit = pattern.exec(code);
        if (hit !== null) {
          problems.push(
            `${label}:${i + 1}: „${hit[0]}” stoi poza regionem generowanym; ten wpis wynika z kontraktu (dostęp lub tier limitera zmienia się w kontrakcie, nie tutaj)`
          );
        }
      }
      out.push(line);
      continue;
    }
    const indent = open[1] ?? '';
    const id = open[2] ?? '';
    const close = `// </generated:contracts:${id}>`;
    let end = i + 1;
    while (end < lines.length && (lines[end] ?? '').trim() !== close) {
      end++;
    }
    if (end >= lines.length) {
      problems.push(`${label}: region ${id} nie ma znacznika zamykającego`);
      out.push(line);
      continue;
    }
    seen.add(id);
    out.push(line);
    const generated = regions.get(id);
    if (generated === undefined) {
      problems.push(
        `${label}: regionu ${id} nie wypełnia żadne pole kontraktu (usuń go)`
      );
    } else {
      for (const g of generated) {
        out.push(`${indent}${g}`);
      }
    }
    out.push(lines[end] ?? '');
    i = end;
  }
  for (const id of regions.keys()) {
    if (!seen.has(id)) {
      problems.push(
        `${label}: brak regionu ${id}; dodaj dwie linie znaczników tam, gdzie mają stać wpisy:\n` +
          `    // <generated:contracts:${id}> from the API contracts by \`npm run system:contracts\`; do not edit\n` +
          `    // </generated:contracts:${id}>`
      );
    }
  }
  return { text: out.join('\n'), problems };
};

/**
 * Human API summaries are Polish product text. The comment policy reads an unquoted Polish
 * sentence as a comment language violation, and a quoted citation is allowed. Guillemets survive
 * an ASCII double-quote inside the sentence (the scanner stops a `"` span at the next `"`).
 */
export const quoteContractSummary = (summary: string): string =>
  `«${summary.replace(/»/g, '').replace(/\*\//g, '* /')}»`;

/** The fields of a contract the combination check reads (runtime values, not types). */
export type ContractShape = {
  key: string;
  kind: unknown;
  method: unknown;
  body: unknown;
  query: unknown;
  querySchema?: unknown;
  path: unknown;
  access?: unknown;
  authCheck?: unknown;
};

/**
 * The generator runs through tsx, which does not type-check, so the combinations the ContractSpec
 * union forbids are checked again at runtime: COMMAND = POST, PATCH or DELETE with a body schema
 * and no query, QUERY = GET without a body; key UPPER_SNAKE; path relative, no leading slash.
 * A `[param]` segment is allowed (salon staff).
 */
export const findIllegalContracts = (
  contracts: readonly ContractShape[]
): string[] => {
  const problems: string[] = [];
  for (const c of contracts) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(c.key)) {
      problems.push(`${c.key}: klucz operacji musi być UPPER_SNAKE`);
    }
    if (
      typeof c.path !== 'string' ||
      c.path.length === 0 ||
      c.path.startsWith('/')
    ) {
      problems.push(`${c.key}: path musi być ścieżką względną pod API_VER`);
    }
    if (c.kind === 'COMMAND') {
      if (
        c.method !== 'POST' &&
        c.method !== 'PATCH' &&
        c.method !== 'DELETE'
      ) {
        problems.push(
          `${c.key}: COMMAND wymaga metody POST, PATCH albo DELETE`
        );
      }
      if (c.body === null || typeof c.body !== 'object') {
        problems.push(`${c.key}: COMMAND wymaga schematu body`);
      }
      if (c.query !== null) {
        problems.push(`${c.key}: COMMAND nie ma pól query`);
      }
      if (c.querySchema != null) {
        problems.push(`${c.key}: COMMAND nie ma schematu query`);
      }
    } else if (c.kind === 'QUERY') {
      if (c.method !== 'GET') {
        problems.push(`${c.key}: QUERY wymaga metody GET`);
      }
      if (c.body !== null) {
        problems.push(`${c.key}: QUERY nie ma body (body: null)`);
      }
    } else if (c.kind === 'CONFIRMATION') {
      if (c.method !== 'GET') {
        problems.push(`${c.key}: CONFIRMATION wymaga metody GET`);
      }
      if (c.body === null || typeof c.body !== 'object') {
        problems.push(`${c.key}: CONFIRMATION wymaga schematu body`);
      }
      if (c.query !== null) {
        problems.push(`${c.key}: CONFIRMATION nie ma pól query`);
      }
      if (c.querySchema != null) {
        problems.push(`${c.key}: CONFIRMATION nie ma schematu query`);
      }
    } else {
      problems.push(`${c.key}: kind musi być COMMAND, QUERY albo CONFIRMATION`);
    }
    if (c.access === 'PUBLIC_NO_GRANT' && c.authCheck !== false) {
      problems.push(`${c.key}: PUBLIC_NO_GRANT wymaga authCheck: false`);
    }
  }
  return problems;
};

/** Apply only after validation and formatting; restore earlier files if a write fails. */
export function applyGeneratedChanges(
  writes: ReadonlyMap<string, string>,
  deletes: readonly string[],
  io: {
    read: (file: string) => string | null;
    write: (file: string, value: string) => void;
    remove: (file: string) => void;
  }
): void {
  const originals = new Map<string, string | null>();
  for (const file of [...writes.keys(), ...deletes])
    originals.set(file, io.read(file));
  const touched: string[] = [];
  try {
    for (const [file, value] of writes) {
      touched.push(file);
      io.write(file, value);
    }
    for (const file of deletes) {
      touched.push(file);
      io.remove(file);
    }
  } catch (error) {
    const failures: unknown[] = [];
    for (const file of touched.reverse()) {
      try {
        const original = originals.get(file);
        if (original === null || original === undefined) io.remove(file);
        else io.write(file, original);
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    }
    if (failures.length)
      throw new AggregateError(
        [error, ...failures],
        'Generator write and rollback failed'
      );
    throw error;
  }
}
