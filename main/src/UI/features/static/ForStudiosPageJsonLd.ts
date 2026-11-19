import { resolveDefaultOgAsset } from '../../assets/brandAssets';
import {
  SEO_CONFIG,
  getLocaleBcp47,
  SOFTWARE_APPLICATION_OS,
} from '@kernel/policies/seo.policy';
import type { IntlMessages } from '../../../types/i18n';
import { resolveMsgKey } from '../../../application/i18n/resolve-msg-key';
import { stripInlineMarkup } from '../../../application/i18n/strip-inline-markup';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { planFeatureHighlights } from '../../../application/pricing/plan-features.catalog';
import { formatPlanFeatureLines } from './planFeatures.jsonld';
import { STUDIO_PREVIEW_FEATURE_COUNT } from './ForStudiosPageData';
import { buildBreadcrumbJsonLd } from './breadcrumb.jsonld';
import { FAQ } from './ForStudiosPageData';
import { createStudioFaqAnswerFormatter } from './ForStudiosPageFaq';

/* ─── Re-export Service JSON-LD (split for max-lines) ─── */

export { buildStudioServiceJsonLd } from './ForStudiosPageJsonLd.service';

interface FaqQuestion {
  readonly '@type': 'Question';
  readonly name: string;
  readonly acceptedAnswer: {
    readonly '@type': 'Answer';
    readonly text: string;
  };
}

export interface FaqJsonLd {
  readonly '@context': 'https://schema.org';
  readonly '@type': 'FAQPage';
  readonly '@id': string;
  readonly inLanguage: string;
  readonly mainEntity: ReadonlyArray<FaqQuestion>;
}

interface HowToStep {
  readonly '@type': 'HowToStep';
  readonly position: number;
  readonly name: string;
  readonly text: string;
}

export interface HowToJsonLd {
  readonly '@context': 'https://schema.org';
  readonly '@type': 'HowTo';
  readonly '@id': string;
  readonly inLanguage: string;
  readonly name: string;
  readonly description: string;
  readonly totalTime: string;
  readonly step: ReadonlyArray<HowToStep>;
}

// Description/featureList/audience w JSON-LD są zlokalizowane
// (seo.forStudios.jsonLd.*) per locale — stała zamieniona na builder wołany
// w getStaticProps. `name: 'Nailfolio Studio'` = nazwa własna planu/produktu,
// NIE tłumaczona.
export const buildStudioSoftwareAppJsonLd = (
  messages: IntlMessages,
  locale: string | undefined = 'pl'
): Record<string, unknown> => {
  const jsonLdKey = (leaf: string): string =>
    resolveMsgKey(messages, `seo.forStudios.jsonLd.${leaf}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${SEO_CONFIG.domain}/for-studios/#software`,
    name: 'Nailfolio Studio',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Salon Management SaaS',
    operatingSystem: SOFTWARE_APPLICATION_OS,
    url: `${SEO_CONFIG.domain}/for-studios/`,
    description: jsonLdKey('appDescription'),
    image: `${SEO_CONFIG.domain}${resolveDefaultOgAsset(locale)}`,
    // Cechy planu Studio = projekcja katalogu cech (to samo co karta Studio),
    // dalej fakty o pracy zespołu bez liczb (klucze 3, 4, 6, 8).
    featureList: [
      ...formatPlanFeatureLines(
        messages,
        locale,
        planFeatureHighlights(
          PricingPlanValue.STUDIO,
          STUDIO_PREVIEW_FEATURE_COUNT
        )
      ),
      ...[3, 4, 6, 8].map(n => jsonLdKey(`feature${n}`)),
    ],
    audience: {
      '@type': 'BusinessAudience',
      audienceType: jsonLdKey('audienceType'),
    },
    inLanguage: ['pl-PL', 'en-US', 'de-DE'],
    // DECISION: no `offers` here. Prices: see ForStudiosPageJsonLd.service.ts. Unlike
    // home/pricing there is no Free-plan offer either: this entity is "Nailfolio Studio" and
    // the page sells only paid plans (PRO_PLUS, STUDIO, SCALE), so a 0 PLN offer would
    // contradict the page and hasOfferCatalog.
    author: { '@id': `${SEO_CONFIG.domain}/#organization` },
    publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
  };
};

export function buildStudioBreadcrumbJsonLd(
  messages: IntlMessages,
  locale: string
): Record<string, unknown> {
  return buildBreadcrumbJsonLd(
    messages,
    locale,
    [
      { labelKey: 'home', path: '/' },
      { labelKey: 'forStudios', path: '/for-studios' },
    ],
    `${SEO_CONFIG.domain}/for-studios/#breadcrumb`
  );
}

export function buildStudioFaqJsonLd(
  messages: IntlMessages,
  locale: string
): FaqJsonLd {
  const inLanguage = getLocaleBcp47(locale);
  const prefix = 'static.forStudios.';
  const formatAnswer = createStudioFaqAnswerFormatter(messages, locale);
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SEO_CONFIG.domain}/for-studios/#faq`,
    inLanguage,
    mainEntity: FAQ.map(item => ({
      '@type': 'Question' as const,
      name: resolveMsgKey(messages, prefix + item.questionKey),
      acceptedAnswer: {
        '@type': 'Answer' as const,
        text: stripInlineMarkup(formatAnswer(item.answerKey)),
      },
    })),
  };
}

export function buildStudioHowToJsonLd(
  messages: IntlMessages,
  locale: string
): HowToJsonLd {
  const inLanguage = getLocaleBcp47(locale);
  const prefix = 'static.forStudios.';
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    '@id': `${SEO_CONFIG.domain}/for-studios/#howto`,
    inLanguage,
    name: resolveMsgKey(messages, prefix + 'how.headline'),
    description: resolveMsgKey(messages, prefix + 'how.lede'),
    totalTime: 'PT15M',
    step: [
      {
        '@type': 'HowToStep',
        position: 1,
        name: resolveMsgKey(messages, prefix + 'how.step1Title'),
        text: resolveMsgKey(messages, prefix + 'how.step1Body'),
      },
      {
        '@type': 'HowToStep',
        position: 2,
        name: resolveMsgKey(messages, prefix + 'how.step2Title'),
        text: resolveMsgKey(messages, prefix + 'how.step2Body'),
      },
      {
        '@type': 'HowToStep',
        position: 3,
        name: resolveMsgKey(messages, prefix + 'how.step3Title'),
        text: resolveMsgKey(messages, prefix + 'how.step3Body'),
      },
    ],
  };
}

export function buildStudioWebPageJsonLd(
  messages: IntlMessages,
  locale: string
): Record<string, unknown> {
  const inLanguage = getLocaleBcp47(locale);
  // Locale-prefixed like PublicSeoHead's canonical (pl bare, en/de prefixed):
  // a Polish url/@id on the EN/DE page contradicted the canonical + hreflang.
  const localePrefix = locale === 'pl' ? '' : `/${locale}`;
  const pageUrl = `${SEO_CONFIG.domain}${localePrefix}/for-studios/`;
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${pageUrl}#webpage`,
    url: pageUrl,
    name: resolveMsgKey(messages, 'seo.forStudios.jsonLd.webPageName'),
    description: resolveMsgKey(
      messages,
      'seo.forStudios.jsonLd.webPageDescription'
    ),
    inLanguage,
    isPartOf: { '@id': `${SEO_CONFIG.domain}/#website` },
    about: { '@id': `${SEO_CONFIG.domain}/for-studios/#software` },
    breadcrumb: { '@id': `${SEO_CONFIG.domain}/for-studios/#breadcrumb` },
    publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
    primaryImageOfPage: {
      '@type': 'ImageObject',
      url: `${SEO_CONFIG.domain}${resolveDefaultOgAsset(locale)}`,
    },
  };
}
