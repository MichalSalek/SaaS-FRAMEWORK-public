import type { IntlMessages } from '../../types/i18n';
import { reportIssueFrontend } from '../error-debugger/errorHandler.possibilities.api';

type JsonRecord = Record<string, unknown>;

const CORE_NAMESPACES = [
  'a11y',
  // Baner komunikatów administracyjnych renderuje się w AppLayout I PublicLayout,
  // więc na każdej stronie. Bez tego etykieta „zamknij" wychodziła surowym kluczem.
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
  'cookieConsent',
  'date',
  'drawer',
  'errors',
  'labels',
  'layout',
  'menu',
  'messages',
  'nav',
  // Dzwoneczek powiadomień (NotificationBell) żyje w AppLayout → renderuje się na
  // KAŻDEJ stronie authed, więc namespace musi być zawsze obecny (jak 'drawer').
  'notifications',
  'phoneMockup',
  'priceSlot',
  'pricing',
  'role',
  'session',
  'share',
  // TrialCountdownBanner żyje w nagłówku AppLayout (każda strona authed).
  // Brak namespace'u = surowe klucze „trialCountdownBanner.title7days" w
  // banerze u KAŻDEJ stylistki na trialu (wykryte na wystawie demo 2026-09-15).
  'trialCountdownBanner',
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
    return { common, events };
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
    return { common, events };
  }
}

function pickNamespaces(
  common: JsonRecord,
  namespaces: readonly string[]
): JsonRecord {
  const result: JsonRecord = {};

  for (const ns of namespaces) {
    const dotIndex = ns.indexOf('.');
    if (dotIndex !== -1) {
      const parent = ns.slice(0, dotIndex);
      const child = ns.slice(dotIndex + 1);
      const parentObj = common[parent];
      if (typeof parentObj === 'object' && parentObj !== null) {
        const parentRecord = parentObj as JsonRecord;
        if (child in parentRecord) {
          if (!(parent in result)) {
            result[parent] = {};
          }
          (result[parent] as JsonRecord)[child] = parentRecord[child];
        }
      }
    } else if (ns in common) {
      result[ns] = common[ns];
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
    return { ...common, events } as IntlMessages;
  }

  const allNamespaces = [...CORE_NAMESPACES, ...pageNamespaces];
  const subset = pickNamespaces(common, allNamespaces);

  return { ...subset, events } as IntlMessages;
}
