import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reconcile, assertMutable, writeReplacement } from './library.mjs';
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-asset-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const status of ['zaakceptowane', 'odrzucone'])
    await fs.mkdir(path.join(dir, 'ilustracje', status), { recursive: true });
  const filename = 'stable-id.png';
  await fs.writeFile(path.join(dir, 'ilustracje', filename), 'owner source');
  return {
    dir,
    manifest: {
      entries: [
        {
          id: 'stable-id',
          category: 'ilustracje',
          filename,
          source: 'ilustracje/' + filename,
          status: 'do-przegladu',
          targets: ['main/public/img/lp/stable.webp'],
        },
      ],
    },
  };
}
test('owner move changes status and retains runtime URL and source bytes', async t => {
  const { dir, manifest } = await fixture(t);
  await fs.rename(
    path.join(dir, manifest.entries[0].source),
    path.join(dir, 'ilustracje/zaakceptowane/stable-id.png')
  );
  await reconcile(dir, manifest);
  assert.equal(manifest.entries[0].status, 'zaakceptowane');
  assert.equal(
    await fs.readFile(path.join(dir, manifest.entries[0].source), 'utf8'),
    'owner source'
  );
  assert.deepEqual(manifest.entries[0].targets, [
    'main/public/img/lp/stable.webp',
  ]);
});
test('missing source blocks publication', async t => {
  const { dir, manifest } = await fixture(t);
  await fs.unlink(path.join(dir, manifest.entries[0].source));
  await assert.rejects(reconcile(dir, manifest), /brak źródła/);
});
test('duplicate source blocks publication', async t => {
  const { dir, manifest } = await fixture(t);
  await fs.copyFile(
    path.join(dir, manifest.entries[0].source),
    path.join(dir, 'ilustracje/zaakceptowane/stable-id.png')
  );
  await assert.rejects(reconcile(dir, manifest), /duplikat/);
});
test('active rejected source blocks sync, but can be resolved for replacement', async t => {
  const { dir, manifest } = await fixture(t);
  await fs.rename(
    path.join(dir, manifest.entries[0].source),
    path.join(dir, 'ilustracje/odrzucone/stable-id.png')
  );
  await assert.rejects(reconcile(dir, manifest), /odrzucony/);
  await reconcile(dir, manifest, { allowRejectedTargets: true });
  assert.equal(manifest.entries[0].status, 'odrzucone');
});

test('generators cannot replace frozen sources', () => {
  assert.throws(() => assertMutable({ status: 'zaakceptowane' }), /zamrożony/);
  assert.doesNotThrow(() => assertMutable({ status: 'do-przegladu' }));
});

async function rejectWithReason(dir, manifest, suffix = '-trzy-palce') {
  const target = 'ilustracje/odrzucone/stable-id' + suffix + '.png';
  await fs.rename(
    path.join(dir, manifest.entries[0].source),
    path.join(dir, target)
  );
  return target;
}
test('owner rejection reason resolves without changing the canonical name or runtime URL', async t => {
  const { dir, manifest } = await fixture(t);
  const source = await rejectWithReason(dir, manifest);
  await reconcile(dir, manifest, { allowRejectedTargets: true });
  assert.equal(manifest.entries[0].source, source);
  assert.equal(manifest.entries[0].filename, 'stable-id.png');
  assert.equal(manifest.entries[0].rejectionReason, 'trzy-palce');
  await assert.rejects(reconcile(dir, manifest), /odrzucony/);
});
test('owner reason may use equals separators', async t => {
  const { dir, manifest } = await fixture(t);
  await rejectWithReason(dir, manifest, '=4=palce');
  await reconcile(dir, manifest, { allowRejectedTargets: true });
  assert.equal(manifest.entries[0].rejectionReason, '4=palce');
});
test('historical variants cannot hide a missing current source', async t => {
  const { dir, manifest } = await fixture(t);
  await fs.unlink(path.join(dir, manifest.entries[0].source));
  for (const suffix of [
    '--poprzedni-123-uwaga',
    '--przed-123',
    '--webp-source',
    '--archived-123',
  ])
    await fs.writeFile(
      path.join(dir, 'ilustracje/odrzucone/stable-id' + suffix + '.png'),
      'history'
    );
  await assert.rejects(
    reconcile(dir, manifest, { allowRejectedTargets: true }),
    /brak źródła/
  );
});
test('multiple owner reasons remain ambiguous rather than picking one silently', async t => {
  const { dir, manifest } = await fixture(t);
  await rejectWithReason(dir, manifest);
  await fs.writeFile(
    path.join(dir, 'ilustracje/odrzucone/stable-id-zle-palce.png'),
    'second'
  );
  await assert.rejects(
    reconcile(dir, manifest, { allowRejectedTargets: true }),
    /duplikat/
  );
});
test('renamed accepted file is not silently reassigned', async t => {
  const { dir, manifest } = await fixture(t);
  await fs.rename(
    path.join(dir, manifest.entries[0].source),
    path.join(dir, 'ilustracje/zaakceptowane/stable-id-nowa.png')
  );
  await assert.rejects(reconcile(dir, manifest), /brak źródła/);
});
test('replacement retains owner reason and bytes in history and restores canonical pending source', async t => {
  const { dir, manifest } = await fixture(t);
  await rejectWithReason(dir, manifest);
  await reconcile(dir, manifest, { allowRejectedTargets: true });
  const entry = manifest.entries[0];
  await writeReplacement(dir, entry, '/tmp/new.png', Buffer.from('new source'));
  assert.equal(entry.source, 'ilustracje/stable-id.png');
  assert.equal(entry.status, 'do-przegladu');
  assert.equal(entry.rejectionReason, undefined);
  const archives = await fs.readdir(path.join(dir, 'ilustracje/odrzucone'));
  assert.equal(archives.length, 1);
  assert.match(archives[0], /^stable-id-trzy-palce--archived-/);
  assert.equal(
    await fs.readFile(
      path.join(dir, 'ilustracje/odrzucone', archives[0]),
      'utf8'
    ),
    'owner source'
  );
  await reconcile(dir, manifest);
});
test('invalid replacement extension leaves owner rejection untouched', async t => {
  const { dir, manifest } = await fixture(t);
  const source = await rejectWithReason(dir, manifest);
  await reconcile(dir, manifest, { allowRejectedTargets: true });
  await assert.rejects(
    writeReplacement(
      dir,
      manifest.entries[0],
      '/tmp/new.webp',
      Buffer.from('bad')
    ),
    /Wyeksportuj/
  );
  assert.equal(
    await fs.readFile(path.join(dir, source), 'utf8'),
    'owner source'
  );
  assert.equal(
    (await fs.readdir(path.join(dir, 'ilustracje/odrzucone'))).length,
    1
  );
});
