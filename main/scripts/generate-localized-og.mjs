/** Render localized brand cards from the exact shipped logo and built product fonts. */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const mainRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = join(mainRoot, 'public');
const cssRoot = join(mainRoot, '.next', 'static', 'css');
const css = readdirSync(cssRoot)
  .filter(name => name.endsWith('.css'))
  .map(name => readFileSync(join(cssRoot, name), 'utf8'))
  .join('\n');
const faces = [...css.matchAll(/@font-face\{[^}]+\}/g)]
  .map(match => match[0])
  .filter(face => /font-family:(?:Marcellus|Instrument Sans);/.test(face));
if (!faces.length)
  throw new Error('Build the frontend first so product fonts are available.');
const fonts = [...new Set(faces)]
  .map(face =>
    face.replace(
      /url\(\/_next\/([^)]*)\)/g,
      (_, path) =>
        `url(data:font/woff2;base64,${readFileSync(join(mainRoot, '.next', path)).toString('base64')})`
    )
  )
  .join('\n');
const logo = readFileSync(join(publicRoot, 'logo.png')).toString('base64');
const brandSource = readFileSync(
  join(
    mainRoot,
    '..',
    '.shared-kernel',
    'domain',
    'platform',
    'brand.config.ts'
  ),
  'utf8'
);
const domain = brandSource.match(/domain:\s*'([^']+)'/)?.[1];
if (!domain) throw new Error('Brand domain is missing from the kernel config.');
const copy = {
  en: ['Online nail portfolio and gallery', 'for nail stylists'],
  de: ['Online-Nagelportfolio und Galerie', 'für Nageldesignerinnen'],
};
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  for (const [locale, lines] of Object.entries(copy)) {
    await page.setContent(`<!doctype html><html lang="${locale}"><meta charset="utf-8"><style>
      ${fonts}
      *{box-sizing:border-box}html,body{width:1200px;height:630px;margin:0;overflow:hidden}
      body{background:#1d1512;color:#efece8;font-family:'Instrument Sans';position:relative}
      .frame{position:absolute;inset:28px;border:1px solid #443b37}
      img{position:absolute;left:100px;top:168px;width:280px;height:280px;object-fit:contain}
      main{position:absolute;left:465px;top:174px;width:685px}
      h1{margin:0 0 20px;font:104px/1 'Marcellus';color:oklch(0.8 0.1337903 352)}
      p{margin:0;font-size:34px;line-height:1.4}
      .domain{margin-top:28px;color:oklch(0.8 0.1337903 352);font-size:29px;font-weight:600}
    </style><body><div class="frame"></div><img alt="" src="data:image/png;base64,${logo}"><main><h1>Nailfolio</h1><p>${lines.join('<br>')}</p><p class="domain">${domain}</p></main></body></html>`);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
    });
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll('h1,p')].some(
        element => element.scrollWidth > element.clientWidth
      )
    );
    if (overflow) throw new Error(`Text exceeds the card frame for ${locale}.`);
    await page.screenshot({
      path: join(publicRoot, `og-default-${locale}.png`),
    });
  }
} finally {
  await browser.close();
}
