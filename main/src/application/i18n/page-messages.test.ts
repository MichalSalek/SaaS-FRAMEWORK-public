// Safety net behind getPublicPageMessages (DECISION in i18n.loader.ts): a page
// ships only the namespaces its components read, so a component that starts
// reading a new namespace must be added to the page's contract, or the user
// sees a raw key. next-intl does not fail a build on a missing message, and
// many messages render only after an interaction (a dialog, a form error), so
// a render test would miss them; the import graph does not.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import plCommon from '../../locales/pl/common.json';
import enCommon from '../../locales/en/common.json';
import deCommon from '../../locales/de/common.json';
import {
  SRC_ROOT,
  collectNamespaceUsage,
  isNamespaceCovered,
  isNamespaceRead,
} from '../../test-utils/i18n-namespace-usage';
import { CORE_NAMESPACES, PUBLIC_CORE_NAMESPACES } from './i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from './page-messages.config';

const PAGES_ROOT = join(SRC_ROOT, 'pages');
const APP_FILE = join(PAGES_ROOT, '_app.tsx');

// `events` is the one namespace a public page reads without shipping it:
// AppSnackbarsController loads it on the first toast (events-messages.ts).
const LAZY_NAMESPACES = ['events'];

function pageFileFor(pattern: string): string {
  const base = pattern === '/' ? '/index' : pattern;
  const direct = join(PAGES_ROOT, `${base}.tsx`);
  try {
    readFileSync(direct);
    return direct;
  } catch {
    return join(PAGES_ROOT, base, 'index.tsx');
  }
}

function listPageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      listPageFiles(path, out);
    } else if (/\.tsx$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

function hasPath(tree: unknown, namespace: string): boolean {
  let node: unknown = tree;
  for (const segment of namespace.split('.')) {
    if (typeof node !== 'object' || node === null || !(segment in node)) {
      return false;
    }
    node = (node as Record<string, unknown>)[segment];
  }
  return true;
}

const appUsage = collectNamespaceUsage([APP_FILE]);

describe('public page messages', () => {
  const patterns = Object.keys(PUBLIC_PAGE_MESSAGES) as Array<
    keyof typeof PUBLIC_PAGE_MESSAGES
  >;

  it.each(patterns)('%s ships every namespace its tree reads', pattern => {
    const spec = PUBLIC_PAGE_MESSAGES[pattern];
    const usage = collectNamespaceUsage([pageFileFor(pattern), APP_FILE]);
    expect(
      Object.fromEntries(
        [...usage.unresolved].map(([call, files]) => [call, [...files]])
      ),
      'useTranslations calls the analysis cannot resolve'
    ).toEqual({});

    const loaded = [...PUBLIC_CORE_NAMESPACES, ...spec.client];
    const missing = [...usage.namespaces]
      .filter(
        ([namespace]) =>
          !LAZY_NAMESPACES.includes(namespace) &&
          !isNamespaceCovered(namespace, loaded)
      )
      .map(([namespace, files]) => `${namespace} (${[...files].join(', ')})`);
    expect(missing, 'add these to client in page-messages.config.ts').toEqual(
      []
    );

    const unread = spec.client.filter(
      entry => !isNamespaceRead(entry, usage.namespaces.keys())
    );
    expect(unread, 'nothing in this page reads these').toEqual([]);
  });

  it('PUBLIC_CORE_NAMESPACES matches what _app and PublicLayout read', () => {
    const layoutUsage = collectNamespaceUsage([
      APP_FILE,
      join(SRC_ROOT, 'UI/layouts/PublicLayout.composition.tsx'),
    ]);
    const expected = [...layoutUsage.namespaces.keys()]
      .filter(namespace => !LAZY_NAMESPACES.includes(namespace))
      .sort();
    expect([...PUBLIC_CORE_NAMESPACES].sort()).toEqual(expected);
  });

  it.each(patterns)(
    '%s reads its contract through getPublicPageMessages',
    pattern => {
      const text = readFileSync(pageFileFor(pattern), 'utf8');
      expect(
        text.includes(`PUBLIC_PAGE_MESSAGES['${pattern}']`),
        `${pattern} must load PUBLIC_PAGE_MESSAGES['${pattern}']`
      ).toBe(true);
    }
  );

  it('every page using getPublicPageMessages has a contract', () => {
    const users = listPageFiles(PAGES_ROOT)
      .filter(file =>
        readFileSync(file, 'utf8').includes('getPublicPageMessages(')
      )
      .map(file => relative(PAGES_ROOT, file));
    const declared = patterns.map(pattern =>
      relative(PAGES_ROOT, pageFileFor(pattern))
    );
    expect(users.sort()).toEqual(declared.sort());
  });

  it('every listed namespace exists in all three locales', () => {
    const listed = new Set<string>([
      ...CORE_NAMESPACES,
      ...PUBLIC_CORE_NAMESPACES,
      ...patterns.flatMap(pattern => [
        ...PUBLIC_PAGE_MESSAGES[pattern].client,
        ...PUBLIC_PAGE_MESSAGES[pattern].build,
      ]),
    ]);
    const absent = [...listed].flatMap(namespace =>
      Object.entries({ pl: plCommon, en: enCommon, de: deCommon })
        .filter(([, tree]) => !hasPath(tree, namespace))
        .map(([locale]) => `${locale}:${namespace}`)
    );
    expect(absent).toEqual([]);
  });

  it('_app reads only namespaces every page ships', () => {
    const missing = [...appUsage.namespaces.keys()].filter(
      namespace =>
        !LAZY_NAMESPACES.includes(namespace) &&
        !isNamespaceCovered(namespace, [...PUBLIC_CORE_NAMESPACES])
    );
    expect(missing).toEqual([]);
  });
});

// Pages on the full core (the logged-in app, login, maintenance) list their
// namespaces inline; the same graph check catches a namespace they forgot.
// Six such gaps were live when this test was written (the dashboard's
// „Konto nieaktywne”, the salon invite e-mail error, the nail-length chips).
describe('pages on getI18nMessages', () => {
  // AppDrawer resolves item labels from its config through a root translator
  // (`useTranslations()`); those keys live in `drawer`, `nav` and `menu`, all
  // in CORE_NAMESPACES.
  const ROOT_TRANSLATOR_FILES = [
    'UI/components/AppDrawer/AppDrawer.organism.tsx',
  ];
  const legacyPages = listPageFiles(PAGES_ROOT).flatMap(file => {
    const text = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const call = /getI18nMessages\(([^,()]+)(?:,\s*([^)]*))?\)/.exec(text);
    if (!call) {
      return [];
    }
    const listSource = call[2]?.trim();
    // No list = the whole message tree (dev tools): nothing can be missing.
    if (listSource === undefined || listSource === '') {
      return [];
    }
    return [{ file: relative(PAGES_ROOT, file), path: file, listSource }];
  });

  it('finds the pages', () => {
    expect(legacyPages.length).toBeGreaterThan(40);
  });

  it.each(legacyPages)('$file loads every namespace its tree reads', page => {
    expect(
      /^\[[\s\S]*\]$/.test(page.listSource),
      'the namespace list must be an inline array literal'
    ).toBe(true);
    const listed = [...page.listSource.matchAll(/'([^']+)'/g)].map(
      match => match[1] ?? ''
    );
    const usage = collectNamespaceUsage([page.path, APP_FILE]);
    const unresolved = [...usage.unresolved].filter(
      ([, files]) =>
        ![...files].every(file => ROOT_TRANSLATOR_FILES.includes(file))
    );
    expect(Object.fromEntries(unresolved)).toEqual({});
    const loaded = [...CORE_NAMESPACES, ...listed, 'events'];
    const missing = [...usage.namespaces]
      .filter(([namespace]) => !isNamespaceCovered(namespace, loaded))
      .map(([namespace, files]) => `${namespace} (${[...files].join(', ')})`);
    expect(missing).toEqual([]);
  });
});
