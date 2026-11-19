import { createTranslator, type AbstractIntlMessages } from 'next-intl';
import type { IntlMessages } from '../../../types/i18n';
import {
  PLAN_FEATURE_NAMESPACE,
  type PlanFeatureLine,
} from '../../../application/pricing/plan-features.catalog';

type LooseTranslate = (
  key: string,
  values?: Readonly<Record<string, number>>
) => string;

// next-intl types message keys only through an `AppConfig` augmentation, which
// this repo deliberately does not enable (DECISION in `types/i18n.d.ts`), so a
// typed `createTranslator` accepts no key at all. The keys used here are pinned
// by `plan-features.catalog.test.ts` in all three locales instead.
const translatorFor = (
  messages: IntlMessages,
  locale: string,
  namespace: string
): LooseTranslate =>
  createTranslator({
    locale,
    messages: messages as unknown as AbstractIntlMessages,
    namespace,
  }) as unknown as LooseTranslate;

/**
 * Build-time wording of plan feature lines for JSON-LD (getStaticProps has no
 * `useTranslations`). Same catalog keys and ICU plurals as the visible cards,
 * so structured data can never promise a different plan than the page.
 */
export function formatPlanFeatureLines(
  messages: IntlMessages,
  locale: string,
  lines: readonly PlanFeatureLine[]
): string[] {
  const t = translatorFor(messages, locale, PLAN_FEATURE_NAMESPACE);
  return lines.map(line => t(line.key, line.params));
}

/** Plan feature lines as one JSON-LD description sentence. */
export function planFeatureSentence(
  messages: IntlMessages,
  locale: string,
  lines: readonly PlanFeatureLine[]
): string {
  return `${formatPlanFeatureLines(messages, locale, lines).join('; ')}.`;
}
