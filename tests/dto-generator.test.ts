/**
 * Generate Prisma DTOs into a disposable file and compare both checked-in baselines.
 * A missing snapshot fails; updates require inspecting the schema and generated diff.
 * Test execution never rewrites the kernel or blesses a snapshot automatically.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const committed = path.join(
  root,
  '.shared-kernel/models/db_models.generated.dto.ts'
);
const snapshot = path.join(
  root,
  'tests/__snapshots__/db_models.generated.dto.ts.snap'
);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-dto-test-'));
const output = path.join(temporary, 'generated.ts');
try {
  assert.ok(
    fs.existsSync(snapshot),
    'Brak snapshotu DTO. Utwórz go dopiero po przeglądzie schematu i generatora.'
  );
  execFileSync(
    process.execPath,
    [
      '--require',
      path.join(root, 'scripts/generate-dto/preload.cjs'),
      '--import',
      'tsx/esm',
      path.join(root, 'scripts/generate-dto/index.ts'),
      '--out',
      output,
    ],
    { cwd: root, stdio: 'pipe' }
  );
  const generated = fs.readFileSync(output, 'utf8');
  assert.equal(
    generated,
    fs.readFileSync(committed, 'utf8'),
    'DTO kernela różni się od wyniku generatora. Sprawdź schemat i wygeneruj DTO.'
  );
  assert.equal(
    generated,
    fs.readFileSync(snapshot, 'utf8'),
    'Snapshot DTO jest nieaktualny. Sprawdź zmianę schematu przed aktualizacją snapshotu.'
  );
  console.log(
    `Generator DTO: zgodne DTO i snapshot (${generated.split('\n').length} linii).`
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
