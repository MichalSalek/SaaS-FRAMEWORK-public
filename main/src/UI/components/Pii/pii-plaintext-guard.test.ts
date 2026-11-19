import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PII, decodePii } from './pii.crypto';

/**
 * Anti-leak guard: the plaintext of the owner's identifying data (decoded from
 * the `PII` SSOT) must NOT appear ANYWHERE in front-end sources (src/). Catches
 * a hardcoded company / tax ID / address instead of <PiiText> /
 * renderLegalText(). Plaintext legitimately lives only in scripts/gen-pii.mjs
 * (outside src/, dev-only).
 */
const PLAINTEXTS = Object.values(PII).map(decodePii);
// vitest starts in `main/`, so src/ = <cwd>/src.
const SRC_DIR = join(process.cwd(), 'src');
const EXTS = ['.ts', '.tsx', '.json'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist']);
// pii.crypto.ts is NOT excluded: it holds only obfuscated blobs, so scanning it
// catches an accidental paste of plaintext (e.g. full gen-pii.mjs output). Only
// this test file itself is excluded.
const SELF = ['pii-plaintext-guard.test.ts'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) {
      continue;
    }
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...walk(p));
    } else if (
      EXTS.some(e => p.endsWith(e)) &&
      !SELF.some(s => p.endsWith(s))
    ) {
      out.push(p);
    }
  }
  return out;
}

describe('PII plaintext guard', () => {
  it('odkodowana tożsamość właściciela nie wycieka do src/', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_DIR)) {
      const txt = readFileSync(file, 'utf8');
      for (const pt of PLAINTEXTS) {
        if (txt.includes(pt)) {
          offenders.push(`${file} :: ${pt}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
