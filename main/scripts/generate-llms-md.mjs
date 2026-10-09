// generate-llms-md.mjs — GENERATOR markdownowych mirrorów stron statycznych dla LLM-ów (GEO).
//
// PO CO: agenty AI (ChatGPT/Gemini/Claude/Perplexity) chętniej cytują treść,
// którą mogą pobrać jako czysty markdown zamiast parsować HTML z hydration-payloadem.
// Konwencja llms.txt (https://llmstxt.org) przewiduje mirror `<url>.md` per strona.
//
// SSOT TREŚCI = i18n (main/src/locales/{pl,en,de}/common.json). Ten skrypt NIE zawiera
// copy stron — renderuje je z tych samych kluczy, których używają komponenty. Zmiana
// copy w JSON + regeneracja = mirror aktualny. Ręcznie kurowane są TYLKO: nagłówki
// plików, tabela planów (BEZ kwot — decyzja ownera 2026-07-10: ceny żyją TYLKO
// w Stripe, llms/mirrory linkują /pricing; zamyka kanał gnicia przy repricingu).
//
// UŻYCIE:  node scripts/generate-llms-md.mjs          (z katalogu main/)
//          node scripts/generate-llms-md.mjs --check  (exit 1 gdy public/ nieświeży)
//
// OUTPUT: public/{route}.md (PL, default locale) + public/{en,de}/{route}.md
//         + public/llms-full.txt (konkatenacja EN, konwencja llms-full)
//         + public/blog/<slug>.md dla wpisów z locale pl, oraz
//           public/<locale>/blog/<slug>.md dla pozostałych locale
//           (brak wpisu w locale = brak pliku, zero pustych mirrorów)
// Pliki generowane SĄ commitowane (jak db_models.generated.dto.ts) — deploy ich
// nie buduje. Świeżości pilnuje audyt tests/audit/llms-md-fresh.sh
// (--check obejmuje też mirrory bloga).

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const ROOT = path.resolve(import.meta.dirname, '..');
const LOCALES = ['pl', 'en', 'de'];
const DOMAIN = 'https://nailfolio.app';

// ---------------------------------------------------------------------------
// Kurowane stałe (jedyne treści spoza i18n; sweep copy:grep obejmuje ten plik
// pośrednio przez llms.txt — zmiana cen/trialu = wyrównaj TU i w llms*.txt)
// ---------------------------------------------------------------------------

const PRICE_TABLE = {
  pl: [
    '| Plan | Dla kogo |',
    '| --- | --- |',
    '| Free | demo: 5 zdjęć, 2 klientki, bez karty |',
    '| Pro | solo stylistka, galeria bez limitu |',
    '| Pro Marka | Pro + pełna historia klientek i kolor marki |',
    '| Studio | salon, cały zespół w cenie, do 10 kont, bez dopłat za stanowisko |',
    '| Scale | sieci salonów, SLA, wycena indywidualna |',
    '',
    `Aktualne ceny (PLN, miesięcznie lub rocznie z oszczędnością 20%): ${DOMAIN}/pricing. Każdy płatny plan zaczyna się 30-dniowym trialem (karta wymagana przy aktywacji, Stripe). Plan Free nie wymaga karty. Klientki zawsze korzystają za darmo.`,
  ],
  en: [
    '| Plan | Best for |',
    '| --- | --- |',
    '| Free | demo: 5 photos, 2 clients, no card |',
    '| Pro | solo stylist, unlimited gallery |',
    '| Pro Marka | Pro + lifelong client history and brand color |',
    '| Studio | salon, whole team included, up to 10 accounts, no per-seat fees |',
    '| Scale | salon chains, SLA, custom pricing |',
    '',
    `Current prices (PLN, billed monthly or yearly with a 20% discount): ${DOMAIN}/en/pricing. Every paid plan starts with a 30-day trial (card required at activation, Stripe). The Free plan needs no card. Clients always use Nailfolio for free.`,
  ],
  de: [
    '| Plan | Für wen |',
    '| --- | --- |',
    '| Free | Demo: 5 Fotos, 2 Kundinnen, ohne Karte |',
    '| Pro | Solo-Stylistin, unbegrenzte Galerie |',
    '| Pro Marka | Pro + dauerhafte Kundinnen-Historie und Markenfarbe |',
    '| Studio | Salon, ganzes Team im Preis, bis 10 Konten, keine Gebühr pro Platz |',
    '| Scale | Salonketten, SLA, individuelle Preise |',
    '',
    `Aktuelle Preise (PLN, monatlich oder jährlich mit 20% Rabatt): ${DOMAIN}/de/pricing. Jeder Bezahlplan beginnt mit einem 30-tägigen Test (Karte bei Aktivierung erforderlich, Stripe). Der Free-Plan braucht keine Karte. Kundinnen nutzen Nailfolio immer kostenlos.`,
  ],
};

const META_LINE = {
  pl: route =>
    `Wersja HTML tej strony: ${htmlUrl('pl', route)} | Mirrory markdown: EN ${mdUrl('en', route)}, DE ${mdUrl('de', route)} | Indeks dla LLM: ${DOMAIN}/llms-pl.txt`,
  en: route =>
    `HTML version of this page: ${htmlUrl('en', route)} | Markdown mirrors: PL ${mdUrl('pl', route)}, DE ${mdUrl('de', route)} | LLM index: ${DOMAIN}/llms.txt`,
  de: route =>
    `HTML-Version dieser Seite: ${htmlUrl('de', route)} | Markdown-Mirrors: PL ${mdUrl('pl', route)}, EN ${mdUrl('en', route)} | LLM-Index: ${DOMAIN}/llms-de.txt`,
};

// ---------------------------------------------------------------------------
// Manifest stron: route → namespace + sekcje w kolejności wizualnej strony.
// type: 'auto' (renderer generyczny) | 'priceTable' | 'compareTable'
//       | 'helpCenterFaq' | 'welcomeFlat'
// ---------------------------------------------------------------------------

const PAGES = [
  {
    route: '',
    file: 'index.md',
    ns: ['pages', 'home'],
    seo: {
      title: ['pages', 'home', 'seoTitle'],
      desc: ['pages', 'home', 'seoDescription'],
    },
    sections: [
      'hero',
      'pain',
      'benefits',
      'steps',
      'fit',
      'clientStrip',
      'studiosStrip',
      'trust',
      'faq',
    ],
  },
  {
    route: 'for-stylists',
    ns: ['static', 'forStylists'],
    seo: {
      title: ['seo', 'forStylists', 'title'],
      desc: ['seo', 'forStylists', 'description'],
    },
    sections: [
      'hero',
      'problems',
      'benefitsSection',
      'playbook',
      'trust',
      'faq',
    ],
  },
  {
    route: 'for-clients',
    ns: ['static', 'forClients'],
    seo: {
      title: ['seo', 'forClients', 'title'],
      desc: ['seo', 'forClients', 'description'],
    },
    sections: [
      'hero',
      'visitMoments',
      'benefits',
      'how',
      'discovery',
      'privacy',
      'trust',
      'inviteStylist',
      'faq',
    ],
  },
  {
    route: 'for-studios',
    ns: ['static', 'forStudios'],
    seo: {
      title: ['seo', 'forStudios', 'title'],
      desc: ['seo', 'forStudios', 'description'],
    },
    sections: [
      'hero',
      'heroMetrics',
      'useCases',
      'operating',
      'benefits',
      'how',
      'roi',
      'trust',
      'faq',
    ],
  },
  {
    route: 'pricing',
    ns: ['static', 'pricing'],
    seo: {
      title: ['seo', 'pricing', 'title'],
      desc: ['seo', 'pricing', 'description'],
    },
    sections: [
      'hero',
      { key: '__priceTable', type: 'priceTable' },
      'trialEndowment',
      'trust',
      'faq',
    ],
  },
  {
    route: 'compare',
    ns: ['static', 'compare'],
    seo: {
      title: ['static', 'compare', 'seo', 'title'],
      desc: ['static', 'compare', 'seo', 'description'],
    },
    sections: [
      'hero',
      { key: 'table', type: 'compareTable' },
      'booking',
      'social',
      'pinterest',
      'phoneQuote',
      'faq',
    ],
  },
  {
    route: 'about',
    ns: ['static', 'about'],
    seo: {
      title: ['seo', 'about', 'title'],
      desc: ['seo', 'about', 'description'],
    },
    sections: [
      'hero',
      'mission',
      'story',
      'values',
      'timeline',
      'stats',
      'trust',
      'faq',
    ],
  },
  {
    route: 'contact',
    ns: ['static', 'contact'],
    seo: {
      title: ['seo', 'contact', 'title'],
      desc: ['seo', 'contact', 'description'],
    },
    sections: ['hero', 'info', 'faq'],
  },
  {
    route: 'help-center',
    ns: ['static', 'helpCenter'],
    seo: {
      title: ['seo', 'helpCenter', 'title'],
      desc: ['seo', 'helpCenter', 'description'],
    },
    sections: [
      'hero',
      'wizard',
      { key: 'faq', type: 'helpCenterFaq' },
      'contactFooter',
    ],
  },
  {
    route: 'get-app',
    ns: ['static', 'getApp'],
    seo: {
      title: ['seo', 'getApp', 'title'],
      desc: ['seo', 'getApp', 'description'],
    },
    sections: ['hero', 'features', 'how', 'trust', 'faq'],
  },
  {
    route: 'welcome',
    ns: ['static', 'welcome'],
    seo: {
      title: ['static', 'welcome', 'seoTitle'],
      desc: ['static', 'welcome', 'seoDescription'],
    },
    sections: [{ key: '__flat', type: 'welcomeFlat' }],
  },
];

// ---------------------------------------------------------------------------
// Renderer generyczny
// ---------------------------------------------------------------------------

// Klucze czysto UI-owe (przyciski, aria, mockupy) — nie niosą treści dla LLM.
const SKIP_KEY =
  /aria|cta|button|placeholder|mockup|sticky|badge|link|state|toggle|switch|photoalt|^alt\d|input|submit|success|error|listmore|learnmore|readtime|search|popular|emptystate|secondary|primary|comingsoon|applabel|periodlabel|period$|microprice|priceunit|^label|savingtext|vatnote|anchoringnote|recommendednote|referenceprice|currentplan|switchplan|scalecta|helpcenterlink|comparelink|pricinglink|homelink/i;

// Klucze nienumerowane, które NIOSĄ treść (whitelist ponad skip-heurystyką długości).
const CONTENT_KEY =
  /^(body|text|intro|summary|quote|pullquote|footnote|note|resolution|foundernote|responsepromise|trustline|reassurance|proof|subtitle|lede|clientsalwaysfree|membersheadline|memberslede)$/i;

const get = (obj, pathArr) =>
  pathArr.reduce((o, k) => (o == null ? undefined : o[k]), obj);

// Odpowiednik kernelowego stripInlineMarkup (resolveMsgKey, ścieżka SEO/JSON-LD):
// copy w i18n zawiera pseudo-tagi dla t.rich (<compareLink>, <em>, <accent>, <strong>).
// W mirrorze markdown zostaje sam tekst.
function stripInlineMarkup(value) {
  let prev = '';
  let out = value;
  while (out !== prev) {
    prev = out;
    out = out.replace(/<([a-zA-Z][\w]*)>([\s\S]*?)<\/\1>/g, '$2');
  }
  return out.replace(/<\/?[a-zA-Z][\w]*\s*\/?>/g, '');
}

// Stringi z parametrami ICU ({count, plural, ...}, {discount}) są interpolowane
// w runtime — statyczny mirror nie może fabrykować wartości, więc je pomijamy.
const hasIcuParams = value => /\{[a-zA-Z]/.test(value);

const cleanText = value => {
  const stripped = stripInlineMarkup(value).trim();
  return hasIcuParams(stripped) ? '' : stripped;
};

const htmlUrl = (locale, route) =>
  `${DOMAIN}${locale === 'pl' ? '' : '/' + locale}/${route ? route + '/' : ''}`;

const mdUrl = (locale, route) => {
  const file = route === '' ? 'index.md' : `${route}.md`;
  return `${DOMAIN}${locale === 'pl' ? '' : '/' + locale}/${file}`;
};

const NUM_KEY = /^([a-zA-Z]+?)(\d{1,2})([A-Z][A-Za-z]*)?$/;

function renderSectionAuto(section) {
  if (typeof section !== 'object' || section == null) return [];
  const out = [];
  const keys = Object.keys(section).filter(k => typeof section[k] === 'string');

  // 1) Nagłówek sekcji
  let heading = section.headline || section.title || section.heading || '';
  if (section.headlineLine1) {
    heading = [section.headlineLine1, section.headlineAccent]
      .filter(Boolean)
      .join(' ');
  } else if (section.heading && section.headingAccent) {
    heading = `${section.heading} ${section.headingAccent}`;
  }
  if (heading) out.push(`## ${heading}`);
  if (section.lede) out.push(section.lede);

  // 2) Grupy numerowane: base+num → {suffix: value}
  const groups = new Map();
  const consumed = new Set([
    'headline',
    'title',
    'heading',
    'headingAccent',
    'headlineLine1',
    'headlineAccent',
    'lede',
  ]);
  for (const k of keys) {
    if (consumed.has(k)) continue;
    const m = k.match(NUM_KEY);
    if (!m) continue;
    const [, base, num, suffix] = m;
    if (SKIP_KEY.test(k)) {
      consumed.add(k);
      continue;
    }
    // Key separator is U+0000, written as an escape. It used to be a raw NUL byte,
    // which made grep, ugrep and `file` classify this whole script as binary and
    // silently skip it, audits included.
    const gk = `${base}\u0000${num}`;
    if (!groups.has(gk)) groups.set(gk, { base, num: Number(num), fields: {} });
    groups.get(gk).fields[suffix || ''] = section[k];
    consumed.add(k);
  }

  // Scal pary q/a o tym samym numerze (FAQ w formie q1/a1)
  const ordered = [...groups.values()].sort(
    (a, b) => a.base.localeCompare(b.base) || a.num - b.num
  );
  const qaByNum = new Map();
  for (const g of ordered) {
    if (g.base === 'q' && g.fields[''])
      qaByNum.set(g.num, { q: g.fields[''], a: qaByNum.get(g.num)?.a });
    if (g.base === 'a' && g.fields[''])
      qaByNum.set(g.num, { q: qaByNum.get(g.num)?.q, a: g.fields[''] });
  }

  const bullets = [];
  const emitted = new Set();
  for (const g of ordered) {
    if (g.base === 'q' || g.base === 'a') {
      if (g.base === 'q') {
        const qa = qaByNum.get(g.num);
        if (qa?.q && qa?.a) {
          out.push(`### ${qa.q}`, qa.a);
          emitted.add(g.num);
        }
      }
      continue;
    }
    const f = g.fields;
    if (f.Question && f.Answer) {
      out.push(`### ${f.Question}`, f.Answer);
    } else if (f.Problem || f.Solution) {
      const parts = [];
      if (f.Problem)
        parts.push(`**${section.problemLabel || 'Problem'}:** ${f.Problem}`);
      if (f.Solution)
        parts.push(`**${section.solutionLabel || 'OK'}:** ${f.Solution}`);
      out.push(parts.join('\n'));
    } else if (f.Name) {
      out.push(`### ${f.Name}${f.Role ? ` (${f.Role})` : ''}`);
      if (f.Bio) out.push(f.Bio);
    } else if (f.Title) {
      const title = f.Year ? `${f.Year}: ${f.Title}` : f.Title;
      out.push(`### ${title}`);
      for (const part of [
        f.Body,
        f.Description,
        f.Detail,
        f.Meta,
        f.Persona,
        f.Proof,
      ])
        if (part) out.push(part);
    } else if (f.Figure) {
      bullets.push(`- ${f.Figure} ${f.Label || ''}`.trim());
    } else if (f.Body && !f.Title) {
      out.push(f.Body);
    } else if (f['']) {
      bullets.push(`- ${f['']}`);
    }
  }
  if (bullets.length) out.push(bullets.join('\n'));

  // 3) Nienumerowane resztki niosące treść
  for (const k of keys) {
    if (consumed.has(k) || SKIP_KEY.test(k)) continue;
    if (CONTENT_KEY.test(k)) out.push(section[k]);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Renderery specjalne
// ---------------------------------------------------------------------------

function renderCompareTable(section) {
  const rows = ['Purpose', 'Client', 'Memory', 'Cost'];
  const out = [];
  if (section.headline) out.push(`## ${section.headline}`);
  if (section.lede) out.push(section.lede);
  const header = `| | ${section.colNailfolio} | ${section.colBooking} | ${section.colSocial} |`;
  const sep = '| --- | --- | --- | --- |';
  const body = rows
    .filter(r => section[`row${r}Label`])
    .map(
      r =>
        `| ${section[`row${r}Label`]} | ${section[`row${r}Nailfolio`]} | ${section[`row${r}Booking`]} | ${section[`row${r}Social`]} |`
    );
  out.push([header, sep, ...body].join('\n'));
  if (section.summary) out.push(section.summary);
  return out;
}

function renderHelpCenterFaq(ns) {
  const out = [];
  const tabs = ['general', 'stylists', 'clients', 'technical'];
  for (const tab of tabs) {
    const items = ns.faq?.[tab];
    if (!items) continue;
    const tabName = ns.tabs?.[tab] || tab;
    out.push(`## ${tabName}`);
    for (let i = 1; i <= 20; i++) {
      const q = items[`q${i}`];
      const a = items[`a${i}`];
      if (q && a) out.push(`### ${q}`, a);
    }
  }
  return out;
}

function renderWelcomeFlat(ns) {
  const out = [];
  const heading = [ns.heading, ns.headingAccent].filter(Boolean).join(' ');
  if (heading) out.push(`## ${heading}`);
  for (const k of ['lede', 'secondaryLede', 'homeCopy', 'pricingCopy'])
    if (ns[k]) out.push(ns[k]);
  return out;
}

// ---------------------------------------------------------------------------
// Budowa plików
// ---------------------------------------------------------------------------

function buildPage(messages, page, locale) {
  const ns = get(messages, page.ns);
  if (!ns)
    throw new Error(`Brak namespace ${page.ns.join('.')} w locale ${locale}`);
  const title = get(messages, page.seo.title) || 'Nailfolio';
  const desc = get(messages, page.seo.desc) || '';

  const blocks = [`# ${title}`, `> ${desc}`, META_LINE[locale](page.route)];

  for (const entry of page.sections) {
    const spec =
      typeof entry === 'string'
        ? { key: entry, type: 'auto' }
        : { type: 'auto', ...entry };
    if (spec.type === 'priceTable') {
      blocks.push(PRICE_TABLE[locale].join('\n'));
    } else if (spec.type === 'compareTable') {
      blocks.push(...renderCompareTable(ns[spec.key] ?? {}));
    } else if (spec.type === 'helpCenterFaq') {
      blocks.push(...renderHelpCenterFaq(ns));
    } else if (spec.type === 'welcomeFlat') {
      blocks.push(...renderWelcomeFlat(ns));
    } else {
      blocks.push(...renderSectionAuto(ns[spec.key]));
    }
  }

  return blocks.filter(Boolean).join('\n\n') + '\n';
}

// Czyści wszystkie stringi drzewa raz, przed renderem — renderery dostają już
// tekst bez pseudo-tagów; stringi ICU stają się '' i wypadają na truthy-checkach.
function deepClean(node) {
  if (typeof node === 'string') return cleanText(node);
  if (Array.isArray(node)) return node.map(deepClean);
  if (node && typeof node === 'object')
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) => [k, deepClean(v)])
    );
  return node;
}

// Blog mirrors. SSOT is src/content/blog/*.mdx, not i18n. Header matches the
// static-page mirrors (H1, description quote, one meta line). Body is the MDX
// source with frontmatter removed, unchanged. Not part of llms-full.txt.
// No prices (owner decision 2026-07-10).
const BLOG_META_LINE = {
  pl: post =>
    `Wersja HTML tej strony: ${blogHtmlUrl(post)} | Data publikacji: ${post.date} | Kategoria: ${post.categoryLabel}`,
  en: post =>
    `HTML version of this page: ${blogHtmlUrl(post)} | Published: ${post.date} | Category: ${post.categoryLabel}`,
  de: post =>
    `HTML-Version dieser Seite: ${blogHtmlUrl(post)} | Veröffentlichungsdatum: ${post.date} | Kategorie: ${post.categoryLabel}`,
};

const blogHtmlUrl = post => {
  const prefix = post.locale === 'pl' ? '' : `/${post.locale}`;
  return `${DOMAIN}${prefix}/blog/${post.slug}/`;
};

const blogOutputRel = post => {
  const file = `${post.slug}.md`;
  return post.locale === 'pl'
    ? path.join('public', 'blog', file)
    : path.join('public', post.locale, 'blog', file);
};

function loadBlogPosts() {
  const dir = path.join(ROOT, 'src', 'content', 'blog');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(name => name.endsWith('.mdx'))
    .sort()
    .map(name => {
      const slug = name.slice(0, -'.mdx'.length);
      const parsed = matter(fs.readFileSync(path.join(dir, name), 'utf8'));
      const { title, description, date, category, locale } = parsed.data;
      for (const [key, value] of Object.entries({
        title,
        description,
        date,
        category,
        locale,
      })) {
        if (typeof value !== 'string' || value.trim() === '') {
          throw new Error(
            `Blog ${name}: pole ${key} musi być niepustym stringiem`
          );
        }
      }
      if (!LOCALES.includes(locale)) {
        throw new Error(
          `Blog ${name}: locale "${locale}" poza ${LOCALES.join(', ')}`
        );
      }
      return {
        slug,
        title,
        description,
        date,
        category,
        locale,
        body: parsed.content,
      };
    });
}

function buildBlogMirror(post) {
  const body = post.body.replace(/^\n+/, '').replace(/\s+$/, '');
  const blocks = [
    `# ${post.title}`,
    `> ${post.description}`,
    BLOG_META_LINE[post.locale](post),
  ];
  if (body) blocks.push(body);
  return blocks.join('\n\n') + '\n';
}

function main() {
  const checkMode = process.argv.includes('--check');
  const outputs = new Map();
  const messagesByLocale = {};

  for (const locale of LOCALES) {
    const messages = deepClean(
      JSON.parse(
        fs.readFileSync(
          path.join(ROOT, 'src', 'locales', locale, 'common.json'),
          'utf8'
        )
      )
    );
    messagesByLocale[locale] = messages;
    for (const page of PAGES) {
      const file = page.file ?? `${page.route}.md`;
      const rel =
        locale === 'pl'
          ? path.join('public', file)
          : path.join('public', locale, file);
      outputs.set(rel, buildPage(messages, page, locale));
    }
  }

  for (const post of loadBlogPosts()) {
    // Category label from the same i18n key the blog UI renders
    // (blog.category.labels.<slug>); the slug is only a fallback, because a
    // model quoting "tips-for-stylists" reads worse than the real section name.
    const label = get(messagesByLocale[post.locale], [
      'blog',
      'category',
      'labels',
      post.category,
    ]);
    outputs.set(
      blogOutputRel(post),
      buildBlogMirror({
        ...post,
        categoryLabel:
          typeof label === 'string' && label ? label : post.category,
      })
    );
  }

  // llms-full.txt = konkatenacja mirrorów EN (konwencja llms-full)
  const enPages = PAGES.map(p => {
    const file = p.file ?? `${p.route}.md`;
    return outputs.get(path.join('public', 'en', file));
  });
  outputs.set(
    path.join('public', 'llms-full.txt'),
    [
      '# Nailfolio: full site content (EN)',
      '',
      `> Concatenated markdown mirrors of every public page. Index: ${DOMAIN}/llms.txt | Polish: ${DOMAIN}/llms-pl.txt | German: ${DOMAIN}/llms-de.txt`,
      '',
      enPages.join('\n---\n\n'),
    ].join('\n')
  );

  let stale = 0;
  for (const [rel, content] of outputs) {
    const abs = path.join(ROOT, rel);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (current === content) continue;
    stale++;
    if (checkMode) {
      console.error(`STALE: main/${rel}`);
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      console.log(`WROTE: main/${rel}`);
    }
  }

  // Orphaned blog mirrors: a deleted or renamed post leaves its .md in public/,
  // and a public file wins over the /blog/[slug] route, so the old text would
  // keep being served to AI agents with a green --check. The generator owns
  // these directories, so write mode removes orphans and check mode fails.
  const blogDirs = [
    path.join('public', 'blog'),
    ...LOCALES.filter(l => l !== 'pl').map(l => path.join('public', l, 'blog')),
  ];
  for (const dir of blogDirs) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of fs.readdirSync(abs).filter(f => f.endsWith('.md'))) {
      const rel = path.join(dir, file);
      if (outputs.has(rel)) continue;
      stale++;
      if (checkMode) {
        console.error(`ORPHAN: main/${rel} (no matching .mdx post)`);
      } else {
        fs.rmSync(path.join(ROOT, rel));
        console.log(`REMOVED: main/${rel}`);
      }
    }
  }

  // The blog sections of llms*.txt are hand-curated (EN/DE lines are
  // translations), so they cannot be regenerated — but every post must be
  // listed in every index, no index may list a post that no longer exists,
  // and the Polish index must carry the frontmatter title verbatim.
  let indexProblems = 0;
  const posts = loadBlogPosts();
  const liveUrls = new Set(posts.map(blogHtmlUrl));
  for (const index of ['llms.txt', 'llms-pl.txt', 'llms-de.txt']) {
    const text = fs.readFileSync(path.join(ROOT, 'public', index), 'utf8');
    for (const post of posts) {
      if (!text.includes(blogHtmlUrl(post))) {
        indexProblems++;
        console.error(
          `INDEX: public/${index} does not list ${blogHtmlUrl(post)}`
        );
      }
    }
    for (const m of text.matchAll(
      /https:\/\/nailfolio\.app\/(?:[a-z]{2}\/)?blog\/[a-z0-9-]+\//g
    )) {
      if (!liveUrls.has(m[0])) {
        indexProblems++;
        console.error(
          `INDEX: public/${index} lists ${m[0]}, which has no post`
        );
      }
    }
    if (index === 'llms-pl.txt') {
      for (const post of posts.filter(p => p.locale === 'pl')) {
        if (!text.includes(`[${post.title}](${blogHtmlUrl(post)})`)) {
          indexProblems++;
          console.error(
            `INDEX: public/${index} has a stale title for ${post.slug}`
          );
        }
      }
    }
  }

  if (indexProblems > 0) {
    // Hand-curated indexes cannot be regenerated: fail in both modes.
    console.error(
      `\nllms indexes out of sync with src/content/blog (${indexProblems}). Fix public/llms*.txt by hand.`
    );
    process.exit(1);
  }
  if (checkMode && stale > 0) {
    console.error(
      `\nllms-md STALE (${stale} plików). Uruchom: cd main && node scripts/generate-llms-md.mjs`
    );
    process.exit(1);
  }
  console.log(
    checkMode
      ? `llms-md FRESH (${outputs.size} plików)`
      : `OK (${outputs.size} plików, ${stale} zapisanych)`
  );
}

main();
