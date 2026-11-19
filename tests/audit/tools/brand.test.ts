// Tests for tools/brand.ts: temp mini trees.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  androidPackageOf,
  checkAssetlinksParity,
  checkJsonLiterals,
  packageNamesOf,
} from './brand';

const tmpRoots: string[] = [];
after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const BRAND =
  "export const BRAND_CONFIG = Object.freeze({\n  // androidPackage: 'com.other.app' in prose\n  androidPackage: 'com.nailfolio.app',\n});\n";
const assetlinks = (...names: string[]): string =>
  JSON.stringify(
    names.map(name => ({
      relation: ['x'],
      target: { namespace: 'android_app', package_name: name },
    }))
  );

/** Mini tree with every root and allowlisted path present, plus extra files. */
function miniTree(extra: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-brand-'));
  tmpRoots.push(root);
  const files: Record<string, string> = {
    'main/src/a.json': '{"a":1}',
    'main/src/locales/pl/common.json':
      '{"terms":"Regulamin serwisu nailfolio.app"}',
    'main/public/.well-known/assetlinks.json': assetlinks('com.nailfolio.app'),
    'web-1/src/b.json': '{}',
    '.shared-kernel/domain/platform/brand.config.ts': BRAND,
    '.shared-kernel/domain/email/locales/email-i18n.pl.json':
      '{"footer":"support@nailfolio.app"}',
    ...extra,
  };
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

void describe('brand: json-literals', () => {
  void it('passes a clean tree and skips the copy channels and assetlinks.json', () => {
    const result = checkJsonLiterals(miniTree());
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.errors, []);
    assert.equal(result.sites, 2);
  });

  const rejected: Record<string, string> = {
    'main/public/manifest.json': '{"scope":"https://nailfolio.app/app"}',
    'main/src/UI/assets/x.json': '{\n  "scheme": "nailfolio://open"\n}',
    'web-1/src/config.json': '{"handle":"@nailfolio_app"}',
    '.shared-kernel/data.json': '{"pkg":"com.nailfolio.app"}',
    'main/public/sw-helper.ts':
      "export const ORIGIN = 'https://nailfolio.app';",
  };
  for (const [rel, text] of Object.entries(rejected)) {
    void it(`rejects ${rel}`, () => {
      const result = checkJsonLiterals(miniTree({ [rel]: text }));
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0]?.file, rel);
    });
  }

  void it('reports the line of the match', () => {
    const result = checkJsonLiterals(
      miniTree({ 'web-1/src/c.json': '{\n\n  "u": "nailfolio.app"\n}' })
    );
    assert.equal(result.findings[0]?.line, 3);
  });

  void it('ignores the READONLY kernel copies and a look-alike host', () => {
    const result = checkJsonLiterals(
      miniTree({
        'main/src/READONLY-shared-kernel/x.json': '{"u":"nailfolio.app"}',
        'main/src/s.json': '{"status":"nailfolio-app.betteruptime.com"}',
      })
    );
    assert.deepEqual(result.findings, []);
  });

  void it('fails when a root or an allowlisted path is gone, and below the floor', () => {
    const root = miniTree();
    rmSync(path.join(root, 'main/src/locales'), { recursive: true });
    const result = checkJsonLiterals(root);
    assert.ok(result.errors.some(e => e.includes('main/src/locales/')));
    assert.ok(checkJsonLiterals(miniTree()).sites < 8);
  });
});

void describe('brand: assetlinks-parity', () => {
  void it('passes when every package_name equals androidPackage', () => {
    const result = checkAssetlinksParity(miniTree());
    assert.deepEqual(result.findings, []);
    assert.equal(result.sites, 1);
  });

  void it('accepts the production package plus its explicit .dev flavor', () => {
    const result = checkAssetlinksParity(
      miniTree({
        'main/public/.well-known/assetlinks.json': assetlinks(
          'com.nailfolio.app',
          'com.nailfolio.app.dev'
        ),
      })
    );
    assert.deepEqual(result.findings, []);
    assert.equal(result.sites, 2);
  });

  void it('requires production even when the dev package is declared', () => {
    const result = checkAssetlinksParity(
      miniTree({
        'main/public/.well-known/assetlinks.json': assetlinks(
          'com.nailfolio.app.dev'
        ),
      })
    );
    assert.ok(
      result.findings.some(f =>
        f.message.includes('missing production package')
      )
    );
  });

  void it('rejects look-alike development suffixes', () => {
    const result = checkAssetlinksParity(
      miniTree({
        'main/public/.well-known/assetlinks.json': assetlinks(
          'com.nailfolio.app',
          'com.nailfolio.app.devil'
        ),
      })
    );
    assert.equal(result.findings.length, 1);
  });

  void it('reports drift, also in a second entry', () => {
    const drift = checkAssetlinksParity(
      miniTree({
        'main/public/.well-known/assetlinks.json': assetlinks(
          'com.nailfolio.app',
          'com.nailfolio.beta'
        ),
      })
    );
    assert.equal(drift.findings.length, 1);
    assert.match(drift.findings[0]?.message ?? '', /com\.nailfolio\.beta/);
  });

  void it('errors when the config lost androidPackage, the JSON is broken or a file is missing', () => {
    const noKey = checkAssetlinksParity(
      miniTree({
        '.shared-kernel/domain/platform/brand.config.ts':
          "// androidPackage: 'x'\nexport const B = {};\n",
      })
    );
    assert.ok(noKey.errors.some(e => e.includes('no androidPackage')));
    const broken = checkAssetlinksParity(
      miniTree({ 'main/public/.well-known/assetlinks.json': '[{' })
    );
    assert.ok(broken.errors.some(e => e.includes('not valid JSON')));
    const root = miniTree();
    rmSync(path.join(root, 'main/public/.well-known/assetlinks.json'));
    assert.ok(checkAssetlinksParity(root).errors.length > 0);
  });

  void it('a file with no package_name reads zero sites (floor)', () => {
    const result = checkAssetlinksParity(
      miniTree({ 'main/public/.well-known/assetlinks.json': '[]' })
    );
    assert.equal(result.sites, 0);
  });

  void it('parses the real shapes', () => {
    assert.equal(androidPackageOf(BRAND), 'com.nailfolio.app');
    assert.deepEqual(
      packageNamesOf(JSON.parse(assetlinks('a', 'b')) as unknown),
      ['a', 'b']
    );
    assert.deepEqual(packageNamesOf({ target: {} }), []);
  });
});
