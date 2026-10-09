#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { reconcile, assertMutable } from './library.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const library = path.join(root, 'assets-library');
const manifest = await reconcile(
  library,
  JSON.parse(await fs.readFile(path.join(library, 'manifest.json'), 'utf8'))
);
const icon = manifest.entries.find(e =>
  e.targets.includes('main/public/favicon.ico')
);
const logo = manifest.entries.find(e =>
  e.targets.includes('main/public/logo.png')
);
if (!icon || !logo) throw new Error('Brak ikony lub logo w bibliotece.');
assertMutable(icon);
const sharp = createRequire(path.join(root, 'main/package.json'))('sharp');
const sizes = [16, 32, 48, 64];
const images = await Promise.all(
  sizes.map(size =>
    sharp(path.join(library, logo.source)).resize(size, size).png().toBuffer()
  )
);
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
for (let i = 0; i < images.length; i++) {
  const start = 6 + 16 * i;
  header[start] = sizes[i];
  header[start + 1] = sizes[i];
  header.writeUInt16LE(1, start + 4);
  header.writeUInt16LE(32, start + 6);
  header.writeUInt32LE(images[i].length, start + 8);
  header.writeUInt32LE(offset, start + 12);
  offset += images[i].length;
}
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-favicon-'));
const file = path.join(dir, 'favicon.ico');
await fs.writeFile(file, Buffer.concat([header, ...images]));
const result = spawnSync(
  process.execPath,
  [path.join(root, 'scripts/assets/library.mjs'), 'replace', icon.id, file],
  { cwd: root, stdio: 'inherit' }
);
if (result.status !== 0) process.exitCode = result.status;
