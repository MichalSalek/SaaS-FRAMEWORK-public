import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PII, decodePii } from './pii.crypto';

/**
 * Strażnik anti-leak: plaintext danych identyfikujących właściciela (odkodowany
 * z SSOT `PII`) NIE może pojawić się NIGDZIE w źródłach front-endu (src/).
 * Łapie regresję, gdy ktoś zahardkoduje firmę / NIP / adres zamiast użyć
 * <PiiText> / renderLegalText(). Plaintext legalnie żyje tylko w
 * scripts/gen-pii.mjs (poza src/, dev-only).
 */
const PLAINTEXTS = Object.values(PII).map(decodePii);
// vitest startuje z katalogu `main/`, więc src/ = <cwd>/src.
const SRC_DIR = join(process.cwd(), 'src');
const EXTS = ['.ts', '.tsx', '.json'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist']);
// pii.crypto.ts NIE jest wykluczony: trzyma tylko zaszyfrowane bloby (nie
// plaintext), więc skanujemy go, by złapać przypadkowe wklejenie plaintextu
// (np. pełnego outputu gen-pii.mjs). Wykluczamy wyłącznie sam plik testu.
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
