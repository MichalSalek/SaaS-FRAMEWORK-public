import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const source = process.cwd();
function snapshot(root: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(out, snapshot(root, rel));
    else if (entry.isFile())
      out[rel] = createHash('sha256')
        .update(readFileSync(path.join(root, rel)))
        .digest('hex');
  }
  return out;
}
for (const scenario of ['invalid generated region', 'unclosed manual region']) {
  test(`invalid input leaves all generator files unchanged: ${scenario}`, t => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'contracts-generator-'));
    t.after(() =>
      import('node:fs').then(fs =>
        fs.rmSync(root, { recursive: true, force: true })
      )
    );
    cpSync(
      path.join(source, '.shared-kernel'),
      path.join(root, '.shared-kernel'),
      { recursive: true }
    );
    mkdirSync(path.join(root, 'scripts/contracts'), { recursive: true });
    for (const file of [
      'generate-contract-registries.ts',
      'registry-regions.ts',
    ])
      cpSync(
        path.join(source, 'scripts/contracts', file),
        path.join(root, 'scripts/contracts', file)
      );
    symlinkSync(
      path.join(source, 'node_modules'),
      path.join(root, 'node_modules'),
      'dir'
    );
    cpSync(path.join(source, 'package.json'), path.join(root, 'package.json'));
    const backend =
      process.env.CONTRACT_TEST_BACKEND_ROOT ?? path.join(source, 'web-1');
    const rate = 'web-1/src/application/http/rate-limit.middleware.ts';
    mkdirSync(path.dirname(path.join(root, rate)), { recursive: true });
    cpSync(
      path.join(backend, 'src/application/http/rate-limit.middleware.ts'),
      path.join(root, rate)
    );
    const stale = path.join(
      root,
      '.shared-kernel/models/favorites/favorite-part-99.dto.ts'
    );
    writeFileSync(stale, 'export type Protected = true;\n');
    const rel = scenario.startsWith('invalid')
      ? '.shared-kernel/domain/events/app-events.const.ts'
      : '.shared-kernel/models/account/account.dto.ts';
    const file = path.join(root, rel);
    const marker = scenario.startsWith('invalid')
      ? '// </generated:contracts:'
      : '// </contracts:manual>';
    const contents = readFileSync(file, 'utf8');
    assert.ok(contents.includes(marker));
    writeFileSync(file, contents.replace(marker, '// INVALID-MARKER '));
    const before = {
      ...snapshot(path.join(root, '.shared-kernel')),
      rate: createHash('sha256')
        .update(readFileSync(path.join(root, rate)))
        .digest('hex'),
    };
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx/esm',
        'scripts/contracts/generate-contract-registries.ts',
      ],
      { cwd: root, encoding: 'utf8' }
    );
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(
      result.stderr,
      scenario.startsWith('invalid') ? /region/i : /manual/i
    );
    assert.deepEqual(
      {
        ...snapshot(path.join(root, '.shared-kernel')),
        rate: createHash('sha256')
          .update(readFileSync(path.join(root, rate)))
          .digest('hex'),
      },
      before
    );
  });
}
