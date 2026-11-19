// Tests for tools/asset-ownership.ts: temp mini trees under os.tmpdir(). The first block replays
// every sample of the retired fixture set tests/audit/_fixtures/asset-ownership-gate (inlined, so
// the proof survives the fixture directory's retirement).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  checkAssetOwnership,
  DOMAIN,
  GATE_FILE,
  MIN_SITES,
} from './asset-ownership';
import type { CheckResult } from './_lib';

const tmpRoots: string[] = [];
after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const GATE_STUB =
  'export const findForeignAssetOwner = async (): Promise<string> => "OWN";\n';

function tree(files: Record<string, string>, withGate = true): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-asset-own-'));
  tmpRoots.push(root);
  const all: Record<string, string> = withGate
    ? { [GATE_FILE]: GATE_STUB, ...files }
    : files;
  mkdirSync(path.join(root, DOMAIN), { recursive: true });
  for (const [rel, text] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const W = `${DOMAIN}/fixture/writer.ts`;
const DECLS = [
  'declare const DB_CLIENT: {',
  '  use: { galleryRecord: { create: (a: unknown) => Promise<unknown> } };',
  '};',
  'declare const extractPublicIdFromUrl: (url: string) => string | null;',
].join('\n');
const GATE_DECL =
  'declare const findForeignAssetOwner: (url: string, accountId: string) => Promise<string>;';

const files = (check: CheckResult): string[] => check.findings.map(f => f.file);
const verdict = (files: Record<string, string>): CheckResult =>
  checkAssetOwnership(tree(files));

void describe('asset-ownership: retired fixture samples', () => {
  void it('must-fail/ungated-writer', () => {
    const c = verdict({
      [W]: `${DECLS}
export const createThing_IO = async (accountId: string, asset_url: string) =>
  DB_CLIENT.use.galleryRecord.create({
    data: {
      created_by_account_id: accountId,
      asset_url,
      public_id: extractPublicIdFromUrl(asset_url),
    },
  });
`,
    });
    assert.deepEqual(files(c), [W]);
    assert.match(
      c.findings[0]?.message ?? '',
      /without calling findForeignAssetOwner\(\)/
    );
  });

  void it('must-fail/bare-escape-marker', () => {
    const c = verdict({
      [W]: `// asset-ownership-allow:
${DECLS}
export const createThing_IO = async (accountId: string, publicId: string) =>
  DB_CLIENT.use.galleryRecord.create({ data: { stylist_account_id: accountId, public_id: publicId } });
`,
    });
    assert.deepEqual(files(c), [W]);
    assert.match(c.findings[0]?.message ?? '', /without a reason/);
  });

  void it('must-pass/documented-exception (seed with a reason + prose-only file)', () => {
    const c = verdict({
      [`${DOMAIN}/fixture/seed.ts`]: `// asset-ownership-allow: seed sklada adresy z wlasnego banku, nie z ciala zadania
${DECLS}
export const seedThing_IO = async (accountId: string, publicId: string) =>
  DB_CLIENT.use.galleryRecord.create({ data: { created_by_account_id: accountId, public_id: publicId } });
`,
      [`${DOMAIN}/fixture/prose-only.ts`]: `/**
 * Kiedyś stało tu \`public_id: extractPublicIdFromUrl(asset_url)\`, ale zapis przeniósł się dalej.
 */
export const DOC_ONLY = true;
`,
    });
    assert.deepEqual(files(c), []);
    assert.equal(c.sites, 1);
  });

  void it('must-pass/gated-writer', () => {
    const c = verdict({
      [W]: `${DECLS}
${GATE_DECL}
export const createThing_IO = async (accountId: string, asset_url: string) => {
  const ownership = await findForeignAssetOwner(asset_url, accountId);
  if (ownership !== 'OWN') return null;
  return DB_CLIENT.use.galleryRecord.create({
    data: { created_by_account_id: accountId, asset_url, public_id: extractPublicIdFromUrl(asset_url) },
  });
};
`,
    });
    assert.deepEqual(files(c), []);
    assert.equal(c.sites, 1);
  });

  void it('must-pass/large-gated-writer (source far beyond pipe capacity)', () => {
    const chunk = `    '${'gallery-metadata-'.repeat(600)}',`;
    const c = verdict({
      [W]: `${GATE_DECL}
export const createLargeGalleryRecord = async (assetUrl: string, owner: string) => {
  const ownership = await findForeignAssetOwner(assetUrl, owner);
  if (ownership !== 'OWN') return null;
  const metadata = [
${Array.from({ length: 12 }, () => chunk).join('\n')}
  ];
  return { public_id: assetUrl, metadata };
};
`,
    });
    assert.deepEqual(files(c), []);
    assert.equal(c.sites, 1);
  });
});

void describe('asset-ownership: sites and gate read from code only', () => {
  void it('does not count public_id in a line comment, block comment, string or template literal', () => {
    const c = verdict({
      [W]: `// public_id: x
/* avatar_public_id: y */
export const a = 'public_id: z';
export const b = \`avatar_public_id: \${a}\`;
`,
    });
    assert.deepEqual(files(c), []);
    assert.equal(c.sites, 0);
  });

  void it('rejects a gate named only in a string (the shell guard accepted the text)', () => {
    const c = verdict({
      [W]: `export const note = 'findForeignAssetOwner(x)';\nexport const row = { public_id: 'p' };\n`,
    });
    assert.deepEqual(files(c), [W]);
  });

  void it('rejects a gate named only in a comment', () => {
    const c = verdict({
      [W]: `// findForeignAssetOwner(url, id) runs elsewhere\nexport const row = { public_id: 'p' };\n`,
    });
    assert.deepEqual(files(c), [W]);
  });

  void it('accepts an alias import of the gate', () => {
    const c = verdict({
      [W]: `import { findForeignAssetOwner as gate } from '../_shared/guards/cloudinary-asset.guard';
export const write = async (url: string) => { await gate(); return { avatar_public_id: url }; };
`,
    });
    assert.deepEqual(files(c), []);
  });

  void it('counts the shorthand, a quoted key, a computed key, a type member and an assignment', () => {
    const c = verdict({
      [W]: `declare const public_id: string;
declare const row: { public_id?: string };
export const a = { public_id };
export const b = { 'public_id': 'x' };
export const c = { ['avatar_public_id']: 'x' };
export type Row = { public_id: string | null };
row.public_id = 'x';
row['public_id'] = 'y';
`,
    });
    // declare row type member + a + b + c + Row + two assignments = 7
    assert.equal(c.sites, 7);
    assert.deepEqual(files(c), [W]);
  });

  void it('rejects an assignment write the shell guard did not see', () => {
    const c = verdict({
      [W]: `declare const row: { public_id?: string };\nrow.public_id = 'x';\n`,
    });
    assert.deepEqual(files(c), [W]);
  });

  void it('does not accept the escape marker from a string literal', () => {
    const c = verdict({
      [W]: `export const m = '// asset-ownership-allow: nope';\nexport const r = { public_id: 'x' };\n`,
    });
    assert.deepEqual(files(c), [W]);
  });

  void it('accepts the escape in a block comment with a reason', () => {
    const c = verdict({
      [W]: `/* asset-ownership-allow: demo seed from its own bank */\nexport const r = { public_id: 'x' };\n`,
    });
    assert.deepEqual(files(c), []);
  });

  void it('skips the gate file itself and test files', () => {
    const c = verdict({
      [GATE_FILE]: `${GATE_STUB}export const where = { public_id: 'x' };\n`,
      [`${DOMAIN}/fixture/writer.test.ts`]: `export const r = { public_id: 'x' };\n`,
    });
    assert.deepEqual(files(c), []);
    assert.equal(c.sites, 0);
  });

  void it('is an error when the gate file is missing', () => {
    const c = checkAssetOwnership(tree({ [W]: 'export {};\n' }, false));
    assert.equal(c.errors.length, 1);
    assert.match(c.errors[0] ?? '', /cloudinary-asset\.guard\.ts/);
  });

  void it('keeps a meaningful floor', () => {
    assert.ok(MIN_SITES >= 5);
  });
});

void it('requires ownership checks for salon logo public ids', () => {
  const check = verdict({
    [W]: 'const update = { salon_logo_public_id: input };',
  });
  assert.deepEqual(files(check), [W]);
  const safe = verdict({
    [W]: 'findForeignAssetOwner(input, owner); const update = { salon_logo_public_id: input };',
  });
  assert.deepEqual(files(safe), []);
});
