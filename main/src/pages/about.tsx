import type { GetStaticPropsContext } from 'next';
import { getPublicPageMessages } from '../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../application/i18n/page-messages.config';
import { resolveMsgKey } from '../application/i18n/resolve-msg-key';
import { AboutPageComposition } from '../UI/features/static/AboutPage.composition';
import { PublicSeoHeadComposition } from '../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../UI/components/JsonLd';
import { getLocaleBcp47, SEO_CONFIG } from '@kernel/policies/seo.policy';
import { buildBreadcrumbJsonLd } from '../UI/features/static/breadcrumb.jsonld';
import type { IntlMessages } from '../types/i18n';

// Name/description w JSON-LD są zlokalizowane (seo.about.jsonLd.*) per locale —
// buildery wołane w getStaticProps, wynik trafia do props (build-time, per locale).
function buildAboutPageJsonLd(
  messages: IntlMessages,
  locale: string
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    '@id': `${SEO_CONFIG.domain}/about/#aboutpage`,
    url: `${SEO_CONFIG.domain}/about/`,
    name: resolveMsgKey(messages, 'seo.about.jsonLd.name'),
    description: resolveMsgKey(messages, 'seo.about.jsonLd.description'),
    inLanguage: getLocaleBcp47(locale),
    isPartOf: { '@id': `${SEO_CONFIG.domain}/#website` },
    mainEntity: { '@id': `${SEO_CONFIG.domain}/#organization` },
    datePublished: '2025-06-01',
    dateModified: '2026-08-18',
  };
}

/** Stałe (nie-copy) atrybuty osi czasu; name/description dołączane z i18n. */
const TIMELINE_EVENTS_META = [
  {
    idFragment: 'event-2024-sketches',
    startDate: '2024-01-01',
    eventStatus: 'https://schema.org/EventCompleted',
    locationUrl: `${SEO_CONFIG.domain}/about/`,
  },
  {
    idFragment: 'event-2025-01-prototype',
    startDate: '2025-01-01',
    eventStatus: 'https://schema.org/EventCompleted',
    locationUrl: `${SEO_CONFIG.domain}/about/`,
  },
  {
    idFragment: 'event-2025-06-pl-legal',
    startDate: '2025-06-01',
    eventStatus: 'https://schema.org/EventCompleted',
    locationUrl: `${SEO_CONFIG.domain}/about/`,
  },
  {
    // DECISION: this event is EventCompleted. StartDate 2026-07-15 was the planned market-exit date;
    // it passed without a launch announcement, but Free sign-up on nailfolio.app is open (web-first).
    // EventScheduled on a past date misled crawlers. The DE/EN expansion stays Scheduled.
    idFragment: 'event-2026-07-launch',
    startDate: '2026-07-15',
    eventStatus: 'https://schema.org/EventCompleted',
    locationUrl: `${SEO_CONFIG.domain}/`,
  },
  {
    idFragment: 'event-2026-expansion',
    startDate: '2026-10-01',
    eventStatus: 'https://schema.org/EventScheduled',
    locationUrl: `${SEO_CONFIG.domain}/about/`,
  },
] as const;

function buildTimelineEventsJsonLd(
  messages: IntlMessages
): Array<Record<string, unknown>> {
  return TIMELINE_EVENTS_META.map((meta, idx) => ({
    '@context': 'https://schema.org',
    '@type': 'Event',
    '@id': `${SEO_CONFIG.domain}/about/#${meta.idFragment}`,
    name: resolveMsgKey(messages, `seo.about.jsonLd.event${idx + 1}Name`),
    description: resolveMsgKey(
      messages,
      `seo.about.jsonLd.event${idx + 1}Description`
    ),
    startDate: meta.startDate,
    eventStatus: meta.eventStatus,
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    location: {
      '@type': 'VirtualLocation',
      url: meta.locationUrl,
    },
    organizer: { '@id': `${SEO_CONFIG.domain}/#organization` },
  }));
}

interface AboutProps {
  aboutPageJsonLd: Record<string, unknown>;
  timelineEventsJsonLd: Array<Record<string, unknown>>;
  faqJsonLd: Record<string, unknown>;
  breadcrumbJsonLd: Record<string, unknown>;
  seoTitle: string;
  seoDescription: string;
}

export default function About({
  aboutPageJsonLd,
  timelineEventsJsonLd,
  faqJsonLd,
  breadcrumbJsonLd,
  seoTitle,
  seoDescription,
}: AboutProps) {
  const jsonLdItems: ReadonlyArray<Record<string, unknown>> = [
    WEBSITE_JSONLD,
    ORGANIZATION_JSONLD,
    aboutPageJsonLd,
    ...timelineEventsJsonLd,
    faqJsonLd,
    breadcrumbJsonLd,
  ];

  return (
    <>
      <PublicSeoHeadComposition
        title={seoTitle}
        description={seoDescription}
        path='/about'
      />
      <JsonLdComposition data={jsonLdItems} id='about' />
      <AboutPageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const resolved = locale ?? 'pl';
  const { messages, buildMessages } = await getPublicPageMessages(
    resolved,
    PUBLIC_PAGE_MESSAGES['/about']
  );

  const prefix = 'static.about.faq.';
  const faqJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SEO_CONFIG.domain}/about/#faq`,
    inLanguage: getLocaleBcp47(resolved),
    mainEntity: ['q1', 'q2', 'q3', 'q4', 'q5'].map((qKey, idx) => ({
      '@type': 'Question',
      name: resolveMsgKey(buildMessages, prefix + qKey),
      acceptedAnswer: {
        '@type': 'Answer',
        text: resolveMsgKey(buildMessages, prefix + `a${idx + 1}`),
      },
    })),
  };

  return {
    props: {
      messages,
      aboutPageJsonLd: buildAboutPageJsonLd(buildMessages, resolved),
      timelineEventsJsonLd: buildTimelineEventsJsonLd(buildMessages),
      faqJsonLd,
      breadcrumbJsonLd: buildBreadcrumbJsonLd(
        buildMessages,
        resolved,
        [
          { labelKey: 'home', path: '/' },
          { labelKey: 'about', path: '/about' },
        ],
        `${SEO_CONFIG.domain}/about/#breadcrumb`
      ),
      seoTitle: resolveMsgKey(buildMessages, 'seo.about.title'),
      seoDescription: resolveMsgKey(buildMessages, 'seo.about.description'),
    },
    revalidate: 3600,
  };
}
