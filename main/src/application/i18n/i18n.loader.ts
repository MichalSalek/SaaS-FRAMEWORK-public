import { mapContactMessages } from './contact-messages';
import type { IntlMessages } from '../../types/i18n';
import { reportIssueFrontend } from '../error-debugger/errorHandler.possibilities.api';
import { resolveSessionExpiryMessages } from '@kernel/domain/session-container/session-container.policy-text';
import { resolveTrialMessages } from '@kernel/domain/stripe/trial-policy-text';

type JsonRecord = Record<string, unknown>;

// Every entry must exist in common.json (page-messages.test.ts checks it):
// six names here once pointed at nothing (`date`, `session`, `pricing`...).
export const CORE_NAMESPACES = [
  'a11y',
  // The admin announcement banner renders in AppLayout AND PublicLayout, so on every page;
  // without it the „zamknij" label shows as a raw key.
  'announcements',
  'bottomNav',
  // Breadcrumb JSON-LD labels (schema.org BreadcrumbList) — resolved at build
  // time by the shared breadcrumb builder on every public static page, so the
  // namespace must always be present wherever getStaticProps materialises
  // structured data (same always-on rationale as 'nav' / 'seo').
  'breadcrumb',
  'buttons',
  'components',
  'cookieBanner',
  'drawer',
  'errors',
  'labels',
  'layout',
  'menu',
  'nav',
  // The notification bell (NotificationBell) lives in AppLayout and renders on EVERY authed page,
  // so the namespace must always be present (like 'drawer').
  'notifications',
  'phoneMockup',
  'role',
  'share',
] as const;

type SupportedLocale = 'de' | 'en' | 'pl';

/**
 * Loads a single locale JSON file by name. Webpack/Next emits a static
 * import map from these dynamic imports, so the literal string switch is
 * required (no template-string concat). Centralizes the `.default as JsonRecord`
 * cast so the parent loader stays declarative.
 */
async function loadJson(
  locale: SupportedLocale,
  name: 'common' | 'events'
): Promise<JsonRecord> {
  if (locale === 'de' && name === 'common') {
    return (await import('../../locales/de/common.json')).default as JsonRecord;
  }
  if (locale === 'de' && name === 'events') {
    return (await import('../../locales/de/events.json')).default as JsonRecord;
  }
  if (locale === 'en' && name === 'common') {
    return (await import('../../locales/en/common.json')).default as JsonRecord;
  }
  if (locale === 'en' && name === 'events') {
    return (await import('../../locales/en/events.json')).default as JsonRecord;
  }
  if (locale === 'pl' && name === 'common') {
    return (await import('../../locales/pl/common.json')).default as JsonRecord;
  }
  return (await import('../../locales/pl/events.json')).default as JsonRecord;
}

function normaliseLocale(locale: string): SupportedLocale {
  if (locale === 'de' || locale === 'en' || locale === 'pl') {
    return locale;
  }
  return 'pl';
}

async function loadLocaleData(
  locale: string
): Promise<{ common: JsonRecord; events: JsonRecord }> {
  const target = normaliseLocale(locale);
  try {
    const [common, events] = await Promise.all([
      loadJson(target, 'common'),
      loadJson(target, 'events'),
    ]);
    return {
      common: resolveTrialMessages(resolveSessionExpiryMessages(common)),
      events: resolveTrialMessages(events),
    };
  } catch (error) {
    reportIssueFrontend({
      namespace: 'I18N',
      message: `Failed to load messages for locale ${locale}`,
      payload:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
      mode: 'error',
    });
    const [common, events] = await Promise.all([
      loadJson('pl', 'common'),
      loadJson('pl', 'events'),
    ]);
    return {
      common: resolveTrialMessages(resolveSessionExpiryMessages(common)),
      events: resolveTrialMessages(events),
    };
  }
}

/**
 * Copies the listed namespaces out of `common`. A dotted entry
 * (`account.plan`, `pages.home.hero`) copies only that subtree, at any depth,
 * and keeps the path above it, so `useTranslations('pages.home.hero')` finds
 * it exactly where the full tree would have it. An entry that does not exist
 * is skipped (pages list namespaces of every locale the same way).
 */
function pickNamespaces(
  common: JsonRecord,
  namespaces: readonly string[]
): JsonRecord {
  const result: JsonRecord = {};

  for (const ns of namespaces) {
    const path = ns.split('.');
    let source: unknown = common;
    for (const segment of path) {
      source =
        typeof source === 'object' && source !== null
          ? (source as JsonRecord)[segment]
          : undefined;
    }
    if (source === undefined) {
      continue;
    }
    let target = result;
    for (const segment of path.slice(0, -1)) {
      const next = target[segment];
      if (typeof next !== 'object' || next === null) {
        target[segment] = {};
      }
      target = target[segment] as JsonRecord;
    }
    const leaf = path[path.length - 1];
    if (leaf !== undefined) {
      // A wider entry already copied (e.g. `account` next to `account.plan`)
      // holds the same object, so assigning it again changes nothing.
      target[leaf] = source;
    }
  }

  return result;
}

export async function getI18nMessages(
  locale: string,
  pageNamespaces?: readonly string[]
): Promise<IntlMessages> {
  const { common, events } = await loadLocaleData(locale);

  if (!pageNamespaces) {
    return mapContactMessages({ ...common, events }, 'encode') as IntlMessages;
  }

  const allNamespaces = [...CORE_NAMESPACES, ...pageNamespaces];
  const subset = pickNamespaces(common, allNamespaces);

  return mapContactMessages({ ...subset, events }, 'encode') as IntlMessages;
}

/**
 * Namespaces that `_app` and `PublicLayout` read on EVERY public page:
 * cookie banner, leave-guard and login-confirm dialogs, the impersonation
 * strip, the header, the footer with its newsletter form, the announcement
 * banner. `page-messages.test.ts` derives this set from the import graph and
 * fails when a component starts reading a namespace that is not here.
 */
export const PUBLIC_CORE_NAMESPACES = [
  'a11y',
  'announcements',
  'buttons',
  'components.aria',
  'components.leaveGuard',
  'components.loginConfirm',
  'cookieBanner',
  'errors',
  'layout.impersonation',
  'layout.public',
  'layout.publicFooter',
  'menu',
  'nav',
  'newsletterForm',
] as const;

/** Per-page message contract of a public page (`page-messages.config.ts`). */
export interface PublicPageMessagesSpec {
  /**
   * Namespaces the page's own component tree reads, on top of
   * PUBLIC_CORE_NAMESPACES. Shipped to the browser in `__NEXT_DATA__`.
   */
  readonly client: readonly string[];
  /**
   * Namespaces only `getStaticProps` / `getServerSideProps` reads (title,
   * description, JSON-LD). Never shipped.
   */
  readonly build: readonly string[];
}

export interface PublicPageMessages {
  /** Goes to `props.messages`, i.e. to NextIntlClientProvider. */
  messages: IntlMessages;
  /** Server side only: what JSON-LD and SEO helpers resolve keys against. */
  buildMessages: IntlMessages;
}

/**
 * DECISION: a public page ships ONLY the namespaces its components read. Otherwise every public
 * page carried the authed-app core (drawer, bottom nav, notification bell, trial banner), all of
 * `events`, the `seo` subtree of every page and, on /pricing, all of `account`: tens of KB of
 * `__NEXT_DATA__` per page, parsed twice, mostly unread. Three rules hold it together:
 *  1. `buildMessages` is the full set (CORE + page list + events), so every server-side string
 *     (title, JSON-LD) resolves as before.
 *  2. `events` is NOT shipped: toasts on public pages load it on first use
 *     (`AppSnackbarsController`, `events-messages.ts`).
 *  3. `page-messages.test.ts` walks each page's import graph and fails when a component reads a
 *     namespace that `messages` does not carry, or when `client` lists one nobody reads.
 */
export async function getPublicPageMessages(
  locale: string,
  spec: PublicPageMessagesSpec
): Promise<PublicPageMessages> {
  const { common, events } = await loadLocaleData(locale);
  const client = pickNamespaces(common, [
    ...PUBLIC_CORE_NAMESPACES,
    ...spec.client,
  ]);
  const build = pickNamespaces(common, [
    ...CORE_NAMESPACES,
    ...PUBLIC_CORE_NAMESPACES,
    ...spec.client,
    ...spec.build,
  ]);
  return {
    messages: mapContactMessages(client, 'encode') as IntlMessages,
    buildMessages: mapContactMessages(
      { ...build, events },
      'crawler'
    ) as IntlMessages,
  };
}
