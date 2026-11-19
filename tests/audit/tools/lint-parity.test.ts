import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { INFRA, REQUIRED_SHARED, run, WORKSPACES } from './lint-parity';

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'lint-parity-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

function base(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const ws of WORKSPACES) {
    for (const file of INFRA) {
      files[path.posix.join(ws, 'eslint-rules', file)] = `// ${file}\n`;
    }
    for (const file of REQUIRED_SHARED)
      files[path.posix.join(ws, 'eslint-rules', 'rules', file)] =
        'export default 1;\n';
    files[path.posix.join(ws, 'eslint-rules', 'rules', 'shared.mjs')] =
      'export default 1;\n';
  }
  files['main/eslint-rules/rules/only-main.mjs'] = 'a';
  files['web-1/eslint-rules/rules/_helper.mjs'] = 'b';
  files['main/eslint-rules/rules/_helper.mjs'] = 'c';
  return files;
}

const findings = (root: string): string[] =>
  run(root).flatMap(check => [
    ...check.findings.map(f => f.file),
    ...check.errors,
  ]);

void describe('lint-parity', () => {
  void it('accepts identical copies; helpers and single-workspace rules are free', () => {
    assert.deepEqual(findings(tree(base())), []);
  });
  void it('rejects drift in an infra copy', () => {
    const files = base();
    files['web-1/eslint-rules/run-guards.mjs'] = '// changed\n';
    assert.deepEqual(findings(tree(files)), [
      'web-1/eslint-rules/run-guards.mjs',
    ]);
  });
  void it('rejects drift in a shared rule (discovered by name)', () => {
    const files = base();
    files['eslint-rules/rules/shared.mjs'] = 'export default 2;\n';
    assert.deepEqual(findings(tree(files)), ['eslint-rules/rules/shared.mjs']);
  });
  void it('errors on a missing infra copy', () => {
    const files = base();
    delete files['main/eslint-rules/lib.mjs'];
    assert.ok(
      findings(tree(files)).some(e =>
        e.includes('missing main/eslint-rules/lib.mjs')
      )
    );
  });
});

void it('rejects a missing workspace copy of a required shared rule', () => {
  const files = base();
  for (const ws of WORKSPACES) {
    files[path.posix.join(ws, 'eslint-rules/rules/brand-literals.mjs')] =
      'export default 1;\n';
    files[path.posix.join(ws, 'eslint-rules/rules/import-boundaries.mjs')] =
      'export default 1;\n';
  }
  delete files['main/eslint-rules/rules/brand-literals.mjs'];
  assert.ok(
    findings(tree(files)).some(f =>
      f.includes('missing main/eslint-rules/rules/brand-literals.mjs')
    )
  );
});
