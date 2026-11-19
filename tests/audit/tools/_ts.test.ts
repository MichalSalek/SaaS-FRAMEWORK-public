// Resolution against a scan tree. The tree is the only disk: a canonical file that exists
// in the real repo must not satisfy a fixture that does not contain it.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { CANONICAL_DEFINE_ENDPOINT } from './endpoint-bind';
import { WEB1_ALIASES } from './stripe';
import { resolvesToModule } from './_ts';

const FROM = 'web-1/src/pages/api/v1/widget/create/index.ts';
const ALIAS = '@app/http/define-endpoint';
const RELATIVE = '../../../../../application/http/define-endpoint';
const INDEX = 'web-1/src/application/http/define-endpoint/index.ts';
const FILE = CANONICAL_DEFINE_ENDPOINT;

const tmpRoots: string[] = [];

after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function scan(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-resolve-'));
  tmpRoots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return root;
}

function resolves(root: string, specifier: string): boolean {
  return resolvesToModule(FROM, specifier, WEB1_ALIASES, FILE, root);
}

void describe('resolvesToModule', () => {
  void it('rejects a missing canonical file when only define-endpoint/index.ts exists', () => {
    const root = scan({
      [INDEX]: 'export function defineEndpoint() { return undefined; }\n',
    });
    assert.equal(resolves(root, ALIAS), false);
    assert.equal(resolves(root, RELATIVE), false);
  });

  void it('accepts the canonical define-endpoint.ts file', () => {
    const root = scan({
      [FILE]: 'export function defineEndpoint() { return undefined; }\n',
    });
    assert.equal(resolves(root, ALIAS), true);
    assert.equal(resolves(root, RELATIVE), true);
  });

  void it('prefers define-endpoint.ts over the directory index', () => {
    const root = scan({
      [FILE]: 'export function defineEndpoint() { return undefined; }\n',
      [INDEX]: 'export function defineEndpoint() { return undefined; }\n',
    });
    assert.equal(resolves(root, ALIAS), true);
    assert.equal(resolves(root, RELATIVE), true);
  });

  void it('rejects a canonical module absent from the scan tree', () => {
    const root = scan({});
    assert.equal(resolves(root, ALIAS), false);
    assert.equal(resolves(root, RELATIVE), false);
  });
});
