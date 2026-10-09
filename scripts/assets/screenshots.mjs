#!/usr/bin/env node
import fs from 'node:fs/promises';
import { reconcile, writeReplacement } from './library.mjs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = fileURLToPath(new URL('../../', import.meta.url));
const sharp = createRequire(path.join(root, 'main/package.json'))('sharp');
const library = path.join(root, 'assets-library');
const manifestPath = path.join(library, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const config = JSON.parse(
  await fs.readFile(
    path.join(root, 'docs/_TRACKERS/s111-app-screens/shots-lp.json'),
    'utf8'
  )
);
const entries = manifest.entries.filter(e => e.category === 'screeny');
// Resolve owner moves before choosing capture targets, including frozen sources.
await reconcile(library, manifest, { allowRejectedTargets: true });
const requested = process.argv.slice(2).flatMap(value => value.split(','));
for (const name of requested) {
  if (
    !config.some(shot => shot.name === name || shot.name.startsWith(name + '-'))
  ) {
    throw new Error(`Nieznany ekran: ${name}`);
  }
}
const mutable = entries.filter(
  e =>
    e.status !== 'zaakceptowane' &&
    (!requested.length ||
      requested.some(
        name =>
          path.basename(e.targets[0], '.webp') === name ||
          path.basename(e.targets[0], '.webp') +
            '-' +
            e.targets[0].match(/\/app\/(pl|en|de)\//)[1] ===
            name
      ))
);
const only = mutable.map(e => {
  const target = e.targets[0];
  return (
    path.basename(target, '.webp') +
    '-' +
    target.match(/\/app\/(pl|en|de)\//)[1]
  );
});
const out =
  process.env.ASSET_CAPTURE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), 'nf-library-capture-')));
if (only.length) {
  const result = process.env.ASSET_CAPTURE_DIR
    ? { status: 0 }
    : spawnSync(
        process.execPath,
        [
          path.join(root, 'docs/_TRACKERS/s111-app-screens/capture.cjs'),
          path.join(root, 'docs/_TRACKERS/s111-app-screens/shots-lp.json'),
          only.join(','),
        ],
        { cwd: root, env: { ...process.env, OUT: out + '/' }, stdio: 'inherit' }
      );
  if (result.status !== 0)
    throw new Error(
      'Odtwarzanie screenów nie powiodło się. Źródła pozostają bez zmian.'
    );
  const evidence = JSON.parse(
    await fs.readFile(path.join(out, 'capture-evidence.json'), 'utf8')
  );
  if (
    only.some(
      name =>
        !evidence.some(
          item => item.name === name && item.ready === true && !item.error
        )
    )
  )
    throw new Error(
      'Niekompletny zestaw screenów. Źródła pozostają bez zmian.'
    );
  const prepared = [];
  for (const entry of mutable) {
    const name = only[mutable.indexOf(entry)],
      source = path.join(out, name + '.png');
    const meta = await sharp(source).metadata();
    if (meta.width !== 780 || meta.height !== 1690)
      throw new Error(`Nieprawidłowy wymiar: ${name}`);
    prepared.push({
      entry,
      data: entry.filename.endsWith('.png')
        ? await fs.readFile(source)
        : await sharp(source).webp({ quality: 94 }).toBuffer(),
    });
  }
  const currentManifest = await reconcile(
    library,
    JSON.parse(await fs.readFile(manifestPath, 'utf8')),
    { allowRejectedTargets: true }
  );
  for (const preparedEntry of prepared) {
    const latestEntry = currentManifest.entries.find(
      e => e.id === preparedEntry.entry.id
    );
    if (!latestEntry) throw new Error('Screen usunięty podczas odtwarzania.');
    Object.assign(preparedEntry.entry, {
      source: latestEntry.source,
      status: latestEntry.status,
    });
  }
  for (const { entry, data } of prepared) {
    if (entry.status === 'zaakceptowane') continue;
    const current = path.join(library, entry.source);
    const previousData = await fs.readFile(current);
    if (previousData.equals(data)) continue;
    await writeReplacement(
      library,
      entry,
      path.join(out, entry.filename),
      data
    );
  }
  const proofPath = path.join(library, 'capture-evidence.json');
  const previous = await fs
    .readFile(proofPath, 'utf8')
    .then(JSON.parse, () => []);
  const merged = [
    ...previous.filter(item => !only.includes(item.name)),
    ...evidence,
  ];
  await fs.writeFile(proofPath, JSON.stringify(merged, null, 2) + '\n');
}
const latest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
for (const entry of entries) {
  const target = latest.entries.find(e => e.id === entry.id);
  if (!target)
    throw new Error(`Screen usunięty podczas odtwarzania: ${entry.id}`);
  Object.assign(target, { source: entry.source, status: entry.status });
  if (entry.rejectionReason) target.rejectionReason = entry.rejectionReason;
  else delete target.rejectionReason;
}
await fs.writeFile(manifestPath, JSON.stringify(latest, null, 2) + '\n');
const result = spawnSync(
  process.execPath,
  [path.join(root, 'scripts/assets/library.mjs'), 'sync'],
  { cwd: root, stdio: 'inherit' }
);
if (result.status !== 0) process.exitCode = result.status;
console.log(
  `Screeny: ${only.length} odtworzonych; ${entries.filter(e => e.status === 'zaakceptowane').length} zaakceptowanych zachowano.`
);
