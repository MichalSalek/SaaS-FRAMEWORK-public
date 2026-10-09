import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../application/i18n/i18n.loader';
import { resolveMsgKey } from '../application/i18n/resolve-msg-key';
import { ContactPageComposition } from '../UI/features/static/ContactPage.composition';
import { PublicSeoHeadComposition } from '../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../UI/components/JsonLd';
import { getLocaleBcp47, SEO_CONFIG } from '@kernel/policies/seo.policy';
import { buildBreadcrumbJsonLd } from '../UI/features/static/breadcrumb.jsonld';
import type { IntlMessages } from '../types/i18n';

// Name/description w JSON-LD są zlokalizowane (seo.contact.jsonLd.*) per
// locale — builder wołany w getStaticProps, wynik trafia do props.
function buildContactPageJsonLd(
  messages: IntlMessages,
  locale: string
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    '@id': `${SEO_CONFIG.domain}/contact/#contactpage`,
    url: `${SEO_CONFIG.domain}/contact/`,
    name: resolveMsgKey(messages, 'seo.contact.jsonLd.name'),
    description: resolveMsgKey(messages, 'seo.contact.jsonLd.description'),
    inLanguage: getLocaleBcp47(locale),
    mainEntity: { '@id': `${SEO_CONFIG.domain}/#organization` },
    isPartOf: { '@id': `${SEO_CONFIG.domain}/#website` },
  };
}

interface ContactProps {
  contactPageJsonLd: Record<string, unknown>;
  faqJsonLd: Record<string, unknown>;
  breadcrumbJsonLd: Record<string, unknown>;
  seoTitle: string;
  seoDescription: string;
}

export default function Contact({
  contactPageJsonLd,
  faqJsonLd,
  breadcrumbJsonLd,
  seoTitle,
  seoDescription,
}: ContactProps) {
  const jsonLdItems: ReadonlyArray<Record<string, unknown>> = [
    WEBSITE_JSONLD,
    ORGANIZATION_JSONLD,
    contactPageJsonLd,
    faqJsonLd,
    breadcrumbJsonLd,
  ];

  return (
    <>
      <PublicSeoHeadComposition
        title={seoTitle}
        description={seoDescription}
        path='/contact'
      />
      <JsonLdComposition data={jsonLdItems} />
      <ContactPageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const resolved = locale ?? 'pl';
  const messages = await getI18nMessages(resolved, [
    'static.contact',
    'validation',
    // account.pay → nagłówek sekcji FAQ (account.pay.faq.eyebrow, "Częste
    // pytania") — static.contact.faq nie ma własnego headline (patrz DECISION
    // w ContactPage.tsx).
    'account.pay',
    'seo',
  ]);

  const prefix = 'static.contact.faq.';
  const faqJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SEO_CONFIG.domain}/contact/#faq`,
    inLanguage: getLocaleBcp47(resolved),
    mainEntity: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((qKey, idx) => ({
      '@type': 'Question',
      name: resolveMsgKey(messages, prefix + qKey),
      acceptedAnswer: {
        '@type': 'Answer',
        text: resolveMsgKey(messages, prefix + `a${idx + 1}`),
      },
    })),
  };

  return {
    props: {
      messages,
      contactPageJsonLd: buildContactPageJsonLd(messages, resolved),
      faqJsonLd,
      breadcrumbJsonLd: buildBreadcrumbJsonLd(
        messages,
        resolved,
        [
          { labelKey: 'home', path: '/' },
          { labelKey: 'contact', path: '/contact' },
        ],
        `${SEO_CONFIG.domain}/contact/#breadcrumb`
      ),
      seoTitle: resolveMsgKey(messages, 'seo.contact.title'),
      seoDescription: resolveMsgKey(messages, 'seo.contact.description'),
    },
    revalidate: 3600,
  };
}
