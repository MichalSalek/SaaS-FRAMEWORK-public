#!/usr/bin/env node
// Source assets live outside public/. Folder moves change review status, never runtime URLs.
import fs from 'node:fs/promises';
import { brandedIllustrationSvg } from './illustration-branding.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const sharp = createRequire(path.join(root, 'main/package.json'))('sharp');
const library = path.join(root, 'assets-library');
const manifestPath = path.join(library, 'manifest.json');
const statuses = ['zaakceptowane', 'odrzucone'];
const categories = [
  'ilustracje',
  'zdjecia-paznokci',
  'zdjecia-kontekstowe',
  'screeny',
  'ozdobniki',
  'marka',
  'archiwum',
];
const hash = data => createHash('sha256').update(data).digest('hex');
const exists = async p => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};
async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result = [];
  for (const e of entries) {
    if (e.isSymbolicLink())
      throw new Error(`Dowiązanie w bibliotece: ${path.join(dir, e.name)}`);
    if (e.isDirectory()) result.push(...(await walk(path.join(dir, e.name))));
    else result.push(path.join(dir, e.name));
  }
  return result;
}
function category(url) {
  if (/\/app\/(pl|en|de)\//.test(url)) return 'screeny';
  if (/\/(process|contextual)\//.test(url)) return 'ilustracje';
  if (/\/(decor|steps|empty)\//.test(url) || url.endsWith('.svg'))
    return 'ozdobniki';
  if (!url.startsWith('/img/')) return 'marka';
  if (/\/(editorial|mockups)\//.test(url)) return 'zdjecia-kontekstowe';
  return 'zdjecia-paznokci';
}
async function sourceMap() {
  const result = new Map();
  // Recover previous generation originals; these files are provenance inputs, never required later.
  for (const name of [
    'nf-fair-photo-sources.json',
    'nf-process-repair-sources.json',
    'nf-context-sources-final.json',
    'nf-young-illustration-sources.json',
    'nf-glamour-sources-final.json',
    'nf-demo-glamour-sources.json',
  ]) {
    const p = path.join('/tmp', name);
    if (!(await exists(p))) continue;
    for (const item of JSON.parse(await fs.readFile(p, 'utf8'))) {
      const url =
        item.url ??
        item.asset ??
        item.job?.assetUrl ??
        item.job?.url ??
        (item.target?.startsWith('main/public')
          ? item.target.slice(11)
          : undefined);
      if (url && item.path && (await exists(item.path)))
        result.set(url, item.path);
    }
  }
  return result;
}
async function init() {
  if (await exists(manifestPath))
    throw new Error('Biblioteka już istnieje. Użyj assets:sync.');
  for (const c of categories)
    for (const s of statuses) {
      const dir = path.join(library, c, s);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, '.gitkeep'), '');
    }
  const sources = await sourceMap();
  const entries = [];
  for (const target of await walk(path.join(root, 'main/public'))) {
    if (!/\.(webp|png|jpe?g|svg|ico)$/i.test(target)) continue;
    const url =
      '/' +
      path
        .relative(path.join(root, 'main/public'), target)
        .split(path.sep)
        .join('/');
    const id =
      path.basename(target, path.extname(target)) +
      '--' +
      hash(url).slice(0, 8);
    const original = sources.get(url) ?? target;
    const locale = url.match(/\/app\/(pl|en|de)\//)?.[1];
    const filename =
      (locale ? id.replace('--', '-' + locale + '--') : id) +
      path.extname(original);
    const relative = path.join(category(url), filename);
    const output = path.join(library, relative);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.copyFile(original, output);
    const meta =
      path.extname(original) === '.ico'
        ? { format: 'ico', width: 32, height: 32 }
        : await sharp(original).metadata();
    const targetMeta =
      path.extname(target) === '.ico'
        ? { format: 'ico', width: 32, height: 32 }
        : await sharp(target).metadata();
    entries.push({
      id,
      category: category(url),
      status: 'do-przegladu',
      source: relative,
      filename,
      targets: [path.relative(root, target)],
      width: meta.width,
      height: meta.height,
      outputWidth: Math.max(targetMeta.width ?? 0, meta.width ?? 0),
      outputHeight: Math.max(targetMeta.height ?? 0, meta.height ?? 0),
      format: targetMeta.format,
      qualityLimited: !sources.has(url) && meta.format !== 'svg',
      publishedHash: hash(await fs.readFile(original)),
    });
  }
  for (const source of await walk(path.join(root, 'docs'))) {
    if (!/\.(png|webp|jpe?g|svg)$/i.test(source)) continue;
    const id =
      path.basename(source, path.extname(source)) +
      '--' +
      hash(path.relative(root, source)).slice(0, 8);
    const filename = id + path.extname(source),
      relative = path.join('archiwum', filename);
    await fs.copyFile(source, path.join(library, relative));
    const meta = await sharp(source).metadata();
    entries.push({
      id,
      category: 'archiwum',
      status: 'do-przegladu',
      source: relative,
      filename,
      targets: [],
      width: meta.width,
      height: meta.height,
    });
  }
  await fs.writeFile(
    manifestPath,
    JSON.stringify({ version: 1, entries }, null, 2) + '\n'
  );
  console.log(
    `Biblioteka: ${entries.length} źródeł. ${sources.size} odzyskanych oryginałów generacji.`
  );
}
export async function reconcile(
  base,
  manifest,
  { allowRejectedTargets = false } = {}
) {
  const files = await walk(base);
  for (const entry of manifest.entries) {
    const canonicalStem = path.basename(
      entry.filename,
      path.extname(entry.filename)
    );
    const matches = files.filter(f => {
      const relative = path.relative(base, f).split(path.sep);
      const filename = path.basename(f);
      if (filename === entry.filename) return true;
      if (relative[0] !== entry.category || relative[1] !== 'odrzucone')
        return false;
      if (path.extname(filename) !== path.extname(entry.filename)) return false;
      const stem = path.basename(filename, path.extname(filename));
      if (!stem.startsWith(canonicalStem)) return false;
      const suffix = stem.slice(canonicalStem.length);
      // Generated historical versions cannot masquerade as the owner's current rejection.
      if (/--(?:poprzedni|przed|webp-source|archived)(?:[-.]|$)/.test(suffix))
        return false;
      return /^[-=_ ]+[^-=_ ]/.test(suffix);
    });
    if (matches.length !== 1)
      throw new Error(
        `${entry.id}: ${matches.length ? 'duplikat pliku' : 'brak źródła'}. Zachowaj nazwę; powód można dopisać tylko w odrzuconych.`
      );
    const relative = path.relative(base, matches[0]);
    const parts = relative.split(path.sep);
    const [c, folder] = parts;
    const s = parts.length === 2 ? 'do-przegladu' : folder;
    if (c !== entry.category || (parts.length !== 2 && !statuses.includes(s)))
      throw new Error(
        `${entry.id}: przenieś plik do kategorii lub folderu zaakceptowane/odrzucone w kategorii ${entry.category}.`
      );
    if (s === 'odrzucone' && entry.targets.length && !allowRejectedTargets)
      throw new Error(
        `${entry.id}: odrzucony plik jest używany przez aplikację. Przypisz zamiennik przed publikacją.`
      );
    entry.source = relative;
    entry.status = s;
    if (s === 'odrzucone' && path.basename(matches[0]) !== entry.filename) {
      entry.rejectionReason = path
        .basename(matches[0], path.extname(matches[0]))
        .slice(canonicalStem.length)
        .replace(/^[-=_ ]+/, '');
    } else {
      delete entry.rejectionReason;
    }
  }
  return manifest;
}
async function sync(checkOnly = false) {
  const manifest = await reconcile(
    library,
    JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  );
  const outputs = [];
  const illustrationLogo = await fs.readFile(
    path.join(root, 'main/public/logo-full.png')
  );

  for (const entry of manifest.entries) {
    if (!entry.targets.length) continue;
    const source = path.join(library, entry.source),
      data = await fs.readFile(source),
      meta =
        entry.format === 'ico'
          ? { width: 32, height: 32 }
          : await sharp(data).metadata();
    entry.width = meta.width;
    entry.height = meta.height;
    for (const target of entry.targets) {
      if (
        !path
          .resolve(root, target)
          .startsWith(path.join(root, 'main/public') + path.sep)
      )
        throw new Error(`Nieprawidłowy cel: ${target}`);
    }
    const sourceHash = hash(
      Buffer.concat([
        data,
        Buffer.from(
          entry.category === 'ilustracje'
            ? 'branded-svg-q97-v2' +
                hash(illustrationLogo) +
                (entry.brandCorner ?? 'top-right')
            : 'photographic-q95-v1'
        ),
      ])
    );
    if (sourceHash === entry.publishedHash) continue;
    for (const target of entry.targets) {
      const absolute = path.resolve(root, target);
      if (!absolute.startsWith(path.join(root, 'main/public') + path.sep))
        throw new Error(`Nieprawidłowy cel: ${target}`);
      let buffer;
      if (
        target.endsWith('.svg') &&
        entry.category === 'ilustracje' &&
        meta.format !== 'svg'
      ) {
        const image = await sharp(data)
          .rotate()
          .webp({ quality: 97, effort: 6 })
          .toBuffer();
        buffer = brandedIllustrationSvg({
          image,
          logo: illustrationLogo,
          width: meta.width,
          height: meta.height,
          corner: entry.brandCorner ?? 'top-right',
        });
      } else if (/\.(svg|ico)$/.test(target)) buffer = data;
      else {
        let image = sharp(data)
          .rotate()
          .resize({ width: entry.outputWidth, withoutEnlargement: true });
        if (target.endsWith('.webp'))
          image = image.webp(
            entry.category === 'ilustracje'
              ? { lossless: true, effort: 6 }
              : { quality: 95, effort: 6 }
          );
        else if (target.endsWith('.png')) image = image.png();
        else image = image.jpeg({ quality: 95 });
        buffer = await image.toBuffer();
      }
      outputs.push({ absolute, buffer });
    }
    entry.publishedHash = sourceHash;
  }
  if (checkOnly) {
    console.log(
      `Biblioteka poprawna; ${outputs.length} pochodnych czeka na aktualizację.`
    );
    return;
  }
  const dimensions = Object.fromEntries(
    manifest.entries.flatMap(entry =>
      entry.targets
        .filter(target => /\.(webp|png|jpe?g|svg)$/.test(target))
        .map(target => [
          target.replace(/^main\/public/, ''),
          {
            width: entry.outputWidth ?? entry.width,
            height: entry.outputHeight ?? entry.height,
          },
        ])
    )
  );
  await fs.writeFile(
    path.join(root, 'main/src/UI/assets/static-asset-dimensions.json'),
    JSON.stringify(dimensions, null, 2) + '\n'
  );
  // All sources and conversions validate before the first runtime write.
  for (const { absolute, buffer } of outputs) {
    await fs.writeFile(absolute + '.asset-tmp', buffer);
    await fs.rename(absolute + '.asset-tmp', absolute);
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  if (outputs.length) {
    const version =
      'library-' +
      hash(manifest.entries.map(e => e.publishedHash ?? e.id).join('')).slice(
        0,
        12
      );
    const config = path.join(root, 'main/src/UI/assets/lp-assets.config.json');
    await fs.writeFile(config, JSON.stringify({ version }, null, 2) + '\n');
    const wm = path.join(root, 'main/public/site.webmanifest');
    let content = await fs.readFile(wm, 'utf8');
    content = content.replace(/\?v=[^"\s]+/g, '?v=' + version);
    await fs.writeFile(wm, content);
  }
  console.log(
    `Zsynchronizowano ${outputs.length} pochodnych. Zaakceptowane oryginały zachowane.`
  );
}
export function assertMutable(entry) {
  if (entry.status === 'zaakceptowane') {
    throw new Error(
      'Plik zaakceptowany jest zamrożony. Generator nie może go zastąpić.'
    );
  }
}
export async function writeReplacement(base, entry, source, data) {
  assertMutable(entry);
  const previous = path.join(base, entry.source);
  // Validate before making any archive copy or changing the current source.
  if (path.extname(source) !== path.extname(entry.filename))
    throw new Error(
      `Wyeksportuj zamiennik jako ${path.extname(entry.filename)}.`
    );
  const previousData = await fs.readFile(previous);
  const stem = path.basename(previous, path.extname(previous));
  let backup = path.join(
    base,
    entry.category,
    'odrzucone',
    stem +
      '--archived-' +
      hash(previousData).slice(0, 8) +
      path.extname(previous)
  );
  const nextSource =
    entry.status === 'odrzucone'
      ? path.join(entry.category, entry.filename)
      : entry.source;
  if (
    nextSource !== entry.source &&
    (await exists(path.join(base, nextSource)))
  )
    throw new Error(`Istnieje już zamiennik: ${nextSource}`);
  if (entry.status === 'odrzucone' && (await exists(backup))) {
    let sequence = 1;
    const originalBackup = backup;
    while (await exists(backup)) {
      backup =
        originalBackup.slice(0, -path.extname(previous).length) +
        '-' +
        sequence++ +
        path.extname(previous);
    }
  }
  if (entry.status !== 'odrzucone' && !(await exists(backup)))
    await fs.copyFile(previous, backup);
  await fs.writeFile(path.join(base, nextSource), data);
  if (entry.status === 'odrzucone') {
    // The reason survives in the archive filename; the next review begins at the canonical path.
    await fs.rename(previous, backup);
    entry.source = nextSource;
    entry.status = 'do-przegladu';
    delete entry.rejectionReason;
  }
}
async function replace(id, source) {
  const manifest = await reconcile(
      library,
      JSON.parse(await fs.readFile(manifestPath, 'utf8')),
      { allowRejectedTargets: true }
    ),
    entry = manifest.entries.find(e => e.id === id);
  if (!entry) throw new Error(`Nieznany identyfikator: ${id}`);
  assertMutable(entry);
  const data = await fs.readFile(source);
  if (entry.format !== 'ico') await sharp(data).metadata();
  await writeReplacement(library, entry, source, data);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Zapisano zamiennik ${id}. Poprzednia wersja w odrzuconych.`);
}
async function main() {
  const [cmd, id, source] = process.argv.slice(2);
  if (cmd === 'init') return init();
  if (cmd === 'sync') return sync();
  if (cmd === 'check') return sync(true);
  if (cmd === 'replace') return replace(id, path.resolve(source));
  if (cmd === 'open') {
    const converted = spawnSync('wslpath', ['-w', library], {
      encoding: 'utf8',
    });
    if (converted.status !== 0)
      throw new Error('Nie udało się odczytać ścieżki Windows.');
    const r = spawnSync('explorer.exe', [converted.stdout.trim()], {
      stdio: 'ignore',
    });
    if (r.error) throw r.error;
    console.log(`Otworzono bibliotekę: ${library}`);
    return;
  }
  throw new Error(
    'Użycie: assets:init | assets:sync | assets:check | assets:open | node scripts/assets/library.mjs replace <id> <źródło>'
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(e => {
    console.error(e.message);
    process.exitCode = 1;
  });
