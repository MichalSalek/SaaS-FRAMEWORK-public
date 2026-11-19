import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = resolve(import.meta.dirname, '../../..');
const PUBLIC = resolve(ROOT, 'main/public');
const DOMAIN = 'https://nailfolio.app';
const INDEXES = [
  { locale: 'en', file: 'llms.txt', heading: 'Useful pages', prefix: '/en' },
  {
    locale: 'pl',
    file: 'llms-pl.txt',
    heading: 'Przydatne strony',
    prefix: '',
  },
  {
    locale: 'de',
    file: 'llms-de.txt',
    heading: 'Nützliche Seiten',
    prefix: '/de',
  },
] as const;

const OFFICIAL_STATIC_ROUTES = [
  '/',
  '/for-stylists/',
  '/for-clients/',
  '/for-studios/',
  '/pricing/',
  '/compare/',
  '/about/',
  '/contact/',
  '/get-app/',
  '/help-center/',
] as const;

const STATIC_ROUTE_PATHS = new Set(
  OFFICIAL_STATIC_ROUTES.map(route => route.replace(/\/$/, '') || '/')
);
const FIRST_PARTY_URL =
  /https:\/\/nailfolio\.app(?:\/[A-Za-z0-9._~!$&'*,;=:@%/?#-]*)?/g;

function readIndex(file: string): string {
  return readFileSync(resolve(PUBLIC, file), 'utf8');
}

function firstPartyUrls(text: string): URL[] {
  return [...text.matchAll(FIRST_PARTY_URL)].map(match => {
    const raw = match[0].replace(/[.,;:]+$/, '');
    return new URL(raw);
  });
}

function sectionBody(text: string, heading: string): string {
  const headingToken = `## ${heading}`;
  const start = text.indexOf(headingToken);
  assert.notEqual(start, -1, `missing section: ${headingToken}`);
  const contentStart = text.indexOf('\n', start) + 1;
  const nextSection = text.indexOf('\n## ', contentStart);
  return text.slice(contentStart, nextSection === -1 ? undefined : nextSection);
}

function expectedPath(
  locale: string,
  prefix: string,
  pathname: string
): string {
  const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (locale === 'pl') {
    assert.ok(
      cleanPath !== '/en' &&
        cleanPath !== '/de' &&
        !cleanPath.startsWith('/en/') &&
        !cleanPath.startsWith('/de/'),
      `Polish index points outside Polish paths: ${pathname}`
    );
    return cleanPath;
  }
  assert.ok(
    cleanPath === prefix || cleanPath.startsWith(`${prefix}/`),
    `${locale} index must target ${prefix} pages: ${pathname}`
  );
  return cleanPath.slice(prefix.length) || '/';
}

function mirrorForPath(prefix: string, localizedPath: string): string {
  const relativePath = localizedPath.slice(prefix.length) || '/';
  const cleanPath = relativePath.replace(/^\/+|\/+$/g, '');
  return resolve(PUBLIC, prefix.slice(1), `${cleanPath || 'index'}.md`);
}

function routeWithLocale(prefix: string, route: string): string {
  return `${prefix}${route}` || '/';
}

function localizedStaticRoute(pathname: string): {
  localePrefix: string;
  semanticPath: string;
} | null {
  let localePrefix = '';
  let semanticPath = pathname;
  if (pathname === '/en' || pathname.startsWith('/en/')) {
    localePrefix = '/en';
    semanticPath = pathname.slice(localePrefix.length) || '/';
  } else if (pathname === '/de' || pathname.startsWith('/de/')) {
    localePrefix = '/de';
    semanticPath = pathname.slice(localePrefix.length) || '/';
  }

  const normalizedPath = semanticPath.replace(/\/$/, '') || '/';
  return STATIC_ROUTE_PATHS.has(normalizedPath)
    ? { localePrefix, semanticPath: normalizedPath }
    : null;
}

const ROBOTS_MATRIX_SCRIPT = String.raw`
import json
import re
import sys
from urllib.robotparser import RobotFileParser

data = json.load(sys.stdin)
parser = RobotFileParser()
parser.set_url(data['domain'] + '/robots.txt')
parser.parse(data['robots'].splitlines())

agents = ['*']
for line in data['robots'].splitlines():
    match = re.match(r'\s*User-agent\s*:\s*(\S+)\s*$', line, re.IGNORECASE)
    if match and match.group(1) not in agents:
        agents.append(match.group(1))

failures = []
private_checks = 0
public_checks = 0
open_agents = []
for agent in agents:
    for path in data['privatePaths']:
        private_checks += 1
        if parser.can_fetch(agent, data['domain'] + path):
            failures.append(f'{agent} can fetch private {path}')
    if parser.can_fetch(agent, data['domain'] + '/'):
        open_agents.append(agent)
        for path in data['publicPaths']:
            public_checks += 1
            if not parser.can_fetch(agent, data['domain'] + path):
                failures.append(f'{agent} cannot fetch public {path}')

print(json.dumps({
    'agents': agents,
    'openAgents': open_agents,
    'privateChecks': private_checks,
    'publicChecks': public_checks,
    'failures': failures,
}))
`;

function runRobotsMatrix(
  robots: string,
  privatePaths: string[],
  publicPaths: string[]
) {
  const result = spawnSync('python3', ['-c', ROBOTS_MATRIX_SCRIPT], {
    encoding: 'utf8',
    input: JSON.stringify({
      domain: DOMAIN,
      robots,
      privatePaths,
      publicPaths,
    }),
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as {
    agents: string[];
    openAgents: string[];
    privateChecks: number;
    publicChecks: number;
    failures: string[];
  };
}

void describe('GEO locale discovery', () => {
  void it('targets each official page in the index language and only existing locale mirrors', () => {
    for (const index of INDEXES) {
      const text = readIndex(index.file);
      const pagesSection = sectionBody(text, index.heading);
      const urls = firstPartyUrls(pagesSection);
      const routePaths = new Set<string>();

      for (const match of pagesSection.matchAll(
        /^- \[Blog[^\]]*\]\((https:\/\/nailfolio\.app[^)]*)\)/gm
      )) {
        const rawBlogIndexUrl = match[1];
        assert.ok(rawBlogIndexUrl, `invalid blog index link in ${index.file}`);
        const blogIndexUrl = new URL(rawBlogIndexUrl);
        expectedPath(index.locale, index.prefix, blogIndexUrl.pathname);
        assert.ok(
          existsSync(resolve(ROOT, 'main/src/pages/blog/index.tsx')),
          `${index.file} points to a missing blog index`
        );
      }

      for (const url of urls) {
        if (
          url.pathname.replace(/^\/(?:en|de)/, '').replace(/\/$/, '') ===
          '/blog'
        ) {
          assert.ok(
            existsSync(resolve(ROOT, 'main/src/pages/blog/index.tsx')),
            `${index.file} points to a missing blog index`
          );
          continue;
        }
        const semanticPath = expectedPath(
          index.locale,
          index.prefix,
          url.pathname
        );
        routePaths.add(
          semanticPath.endsWith('/') && semanticPath !== '/'
            ? semanticPath.slice(0, -1)
            : semanticPath
        );

        assert.ok(
          existsSync(mirrorForPath(index.prefix, url.pathname)),
          `${index.file} points to a page without a ${index.locale} Markdown mirror: ${url.pathname}`
        );
        const mirror = readFileSync(
          mirrorForPath(index.prefix, url.pathname),
          'utf8'
        );
        const htmlTargetMatch = mirror.match(
          /^(?:HTML version of this page|Wersja HTML tej strony|HTML-Version dieser Seite): (\S+)/m
        );
        const htmlTarget = htmlTargetMatch?.[1];
        assert.ok(
          htmlTarget,
          `${index.file} target mirror has no HTML URL: ${url.pathname}`
        );
        assert.equal(
          new URL(htmlTarget).href,
          url.href,
          `${index.file} target differs from the locale HTML URL in its mirror: ${url.pathname}`
        );
      }

      for (const route of OFFICIAL_STATIC_ROUTES) {
        const semantic = route.replace(/\/$/, '') || '/';
        assert.ok(
          routePaths.has(semantic),
          `${index.file} is missing its ${index.locale} page ${route}`
        );
      }
    }
  });

  void it('uses same-language targets for static page links outside the cross-locale mirror list', () => {
    for (const index of INDEXES) {
      const text = readIndex(index.file);
      const markdownSectionStart = text.search(
        /^## (?:Markdown mirrors|Mirrory markdown|Markdown-Spiegel)/m
      );
      const content =
        markdownSectionStart === -1
          ? text
          : text.slice(0, markdownSectionStart);

      for (const url of firstPartyUrls(content)) {
        const route = localizedStaticRoute(url.pathname);
        if (!route || route.semanticPath === '/') {
          continue;
        }
        assert.equal(
          route.localePrefix,
          index.prefix,
          `${index.file} points to the wrong language page: ${url.pathname}`
        );
      }
    }
  });

  void it('links every language index and lists only blog translations with real mirrors', () => {
    const indexUrls = [
      `${DOMAIN}/llms.txt`,
      `${DOMAIN}/llms-pl.txt`,
      `${DOMAIN}/llms-de.txt`,
    ];

    for (const index of INDEXES) {
      const text = readIndex(index.file);
      for (const indexUrl of indexUrls) {
        assert.ok(
          text.includes(indexUrl),
          `${index.file} is missing ${indexUrl}`
        );
      }

      for (const match of text.matchAll(
        /https:\/\/nailfolio\.app(\/(?:en|de))?\/blog\/([a-z0-9-]+)\/?/g
      )) {
        const prefix = match[1] ?? '';
        const slug = match[2];
        assert.ok(
          existsSync(resolve(PUBLIC, prefix.slice(1), 'blog', `${slug}.md`)),
          `${index.file} lists a blog translation without a generated mirror: ${match[0]}`
        );
      }
    }
  });

  void it('projects current home metadata and real welcome actions into each language mirror', () => {
    for (const { prefix, locale } of INDEXES) {
      const messages = JSON.parse(
        readFileSync(
          resolve(ROOT, 'main/src/locales', locale, 'common.json'),
          'utf8'
        )
      );
      const home = readFileSync(
        resolve(PUBLIC, prefix.slice(1), 'index.md'),
        'utf8'
      );
      assert.ok(home.startsWith(`# ${messages.seo.home.title}\n`));
      assert.ok(home.includes(`> ${messages.seo.home.description}\n`));
      const welcome = readFileSync(
        resolve(PUBLIC, prefix.slice(1), 'welcome.md'),
        'utf8'
      );
      assert.ok(welcome.includes(messages.static.welcome.ctaPrimary));
      assert.ok(welcome.includes(messages.static.welcome.ctaLogin));
      assert.ok(
        !welcome.includes('?intent=register&role='),
        'shared welcome does not select a role'
      );
      for (const href of [
        `${DOMAIN}${prefix}/user/login/?intent=register`,
        `${DOMAIN}${prefix}/user/login/`,
        `${DOMAIN}${prefix}/pricing/`,
      ])
        assert.ok(welcome.includes(href), `${locale} welcome lost ${href}`);
      assert.ok(
        !welcome.includes(messages.static.welcome.secondaryLede),
        'ARIA navigation label is not body copy'
      );
    }
  });

  void it('keeps the shared blog registration and pricing footer in the mirror language', () => {
    for (const { prefix, locale } of INDEXES) {
      const directory = resolve(PUBLIC, prefix.slice(1), 'blog');
      for (const file of readdirSync(directory).filter(name =>
        name.endsWith('.md')
      )) {
        const text = readFileSync(resolve(directory, file), 'utf8');
        assert.ok(
          text.includes(
            `${DOMAIN}${prefix}/user/login/?intent=register&role=stylist`
          ),
          `${locale}/${file} lost its localized registration destination`
        );
        assert.ok(
          text.includes(`${DOMAIN}${prefix}/pricing/`),
          `${locale}/${file} lost its localized pricing destination`
        );
      }
    }
  });

  void it('blocks private routes in every locale for each robots group and preserves public crawl paths', () => {
    const locales = ['', '/en', '/de'];
    const privateRouteSuffixes = [
      '/app/',
      '/app/home/',
      '/app/clients/geo-test/',
      '/app/admin/',
      '/user/login',
      '/connection-check/',
      '/pairing/',
      '/email/unsubscribe?token=geo-test',
      '/admin/',
      '/salon-invitation?token=geo-test',
    ];
    const privatePaths = locales.flatMap(prefix =>
      privateRouteSuffixes.map(route => routeWithLocale(prefix, route))
    );

    const publicPageSuffixes = [
      '/',
      '/blog/',
      '/stylist/geo-test-profile/',
      '/salon/geo-test-salon/',
      '/s/geo-test-salon/',
    ];
    const publicPaths = locales.flatMap(prefix =>
      publicPageSuffixes.map(route => routeWithLocale(prefix, route))
    );
    const plBlogMirror = readdirSync(resolve(PUBLIC, 'blog')).find(name =>
      name.endsWith('.md')
    );
    assert.ok(plBlogMirror, 'expected a generated Polish blog mirror');
    const enBlogMirror = readdirSync(resolve(PUBLIC, 'en/blog')).find(name =>
      name.endsWith('.md')
    );
    assert.ok(enBlogMirror, 'expected a generated English blog mirror');
    const deBlogMirror = readdirSync(resolve(PUBLIC, 'de/blog')).find(name =>
      name.endsWith('.md')
    );
    assert.ok(deBlogMirror, 'expected a generated German blog mirror');
    publicPaths.push(
      '/api/og/stylist/geo-test-profile',
      '/og-portfolio.png',
      '/index.md',
      '/en/index.md',
      '/de/index.md',
      `/blog/${plBlogMirror}`,
      `/en/blog/${enBlogMirror}`,
      `/de/blog/${deBlogMirror}`,
      '/llms.txt',
      '/llms-pl.txt',
      '/llms-de.txt',
      '/llms-full.txt',
      '/sitemap.xml',
      '/sitemap-static.xml',
      '/sitemap-profiles.xml',
      '/sitemap-blog.xml'
    );

    const result = runRobotsMatrix(
      readFileSync(resolve(PUBLIC, 'robots.txt'), 'utf8'),
      privatePaths,
      publicPaths
    );
    assert.equal(
      result.failures.length,
      0,
      result.failures.slice(0, 20).join('\n')
    );
    assert.ok(result.openAgents.includes('Googlebot'));
    assert.ok(result.openAgents.includes('OAI-SearchBot'));
    assert.ok(result.openAgents.includes('GPTBot'));
    assert.ok(result.openAgents.includes('ClaudeBot'));
    assert.ok(result.privateChecks >= result.agents.length * 30);
    assert.ok(result.publicChecks > 0);
  });
});
