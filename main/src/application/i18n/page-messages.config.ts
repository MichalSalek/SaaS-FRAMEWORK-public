// Per-page message contract of every public page, keyed by the Next.js page
// pattern (`__NEXT_DATA__.page`). Consumed by the page's data function through
// getPublicPageMessages (DECISION there, i18n.loader.ts).
//
// `client` = what the page's components read beyond PUBLIC_CORE_NAMESPACES;
// `build` = what only getStaticProps / getServerSideProps reads (title,
// description, JSON-LD). page-messages.test.ts walks each page's import graph
// and fails on a missing `client` namespace or on one nobody reads.
import type { PublicPageMessagesSpec } from './i18n.loader';

export const PUBLIC_PAGE_MESSAGES = {
  '/': {
    client: [
      'pages.home',
      'static.reviews',
      'phoneMockup',
      'components.lpScenes',
      'components.phoneStage',
      'components.marketingVideo',
      'components.timeValue',
      'account.plan',
    ],
    build: [
      'account.plan',
      'pages.home',
      'static.reviews',
      'validation',
      'seo',
    ],
  },
  '/about': {
    client: ['static.about', 'account.pay.faq', 'phoneMockup'],
    build: ['static.about', 'account.pay', 'seo'],
  },
  '/compare': {
    client: ['static.compare', 'account.plan', 'phoneMockup'],
    build: ['static.compare', 'account.plan'],
  },
  '/contact': {
    client: ['static.contact', 'account.pay.faq'],
    build: ['static.contact', 'validation', 'account.pay', 'seo'],
  },
  '/for-clients': {
    client: [
      'static.forClients',
      'static.reviews',
      'phoneMockup',
      'components.phoneStage',
    ],
    build: ['static.forClients', 'static.reviews', 'seo'],
  },
  '/for-studios': {
    client: [
      'static.forStudios',
      'static.pricing',
      'static.reviews',
      'account.plan',
    ],
    build: [
      'static.forStudios',
      'static.pricing',
      'static.reviews',
      'account.plan',
      'seo',
    ],
  },
  '/for-stylists': {
    client: [
      'static.forStylists',
      'static.pricing',
      'static.reviews',
      'account.plan',
      'phoneMockup',
      'components.lpScenes',
      'components.phoneStage',
      'components.timeValue',
    ],
    build: [
      'static.forStylists',
      'static.pricing',
      'static.reviews',
      'account.plan',
      'seo',
    ],
  },
  '/get-app': {
    client: [
      'static.getApp',
      'static.reviews',
      'account.pay.faq',
      'pages.home.hero',
      'pages.home.benefits',
      'phoneMockup',
      'components.lpScenes',
    ],
    build: [
      'static.getApp',
      'static.reviews',
      'account.pay',
      'pages.home',
      'seo',
    ],
  },
  '/pricing': {
    client: [
      'static.pricing',
      'static.reviews',
      'account.plan',
      'phoneMockup',
      'components.phoneStage',
    ],
    build: ['static.pricing', 'static.reviews', 'account', 'validation', 'seo'],
  },
  '/404': {
    client: ['static.notFound'],
    build: ['static.notFound', 'seo'],
  },
  '/500': {
    client: ['pages.serverError'],
    build: ['pages.serverError'],
  },
  '/_error': {
    client: ['static.genericError'],
    build: ['static.genericError'],
  },
  '/blog': {
    client: ['blog.category', 'blog.list'],
    build: ['blog', 'seo'],
  },
  '/blog/[slug]': {
    client: ['account.plan', 'blog.category', 'blog.post', 'blog.postCta'],
    build: ['blog', 'account.plan', 'breadcrumb'],
  },
  '/blog/category/[category]': {
    client: ['blog.category'],
    build: ['blog', 'seo'],
  },
  '/connection-check': {
    client: ['pages.connectionCheck'],
    build: ['pages.connectionCheck'],
  },
  '/content-moderation': {
    client: ['pages.contentModeration'],
    build: ['pages.contentModeration', 'seo'],
  },
  '/cookies': {
    client: ['static.cookies', 'static.legal'],
    build: ['static.cookies', 'static.legal', 'seo'],
  },
  '/email/unsubscribe': {
    client: ['pages.emailUnsubscribe'],
    build: ['pages.emailUnsubscribe'],
  },
  '/help-center': {
    client: ['static.helpCenter'],
    build: ['static.helpCenter', 'seo'],
  },
  '/privacy': {
    client: ['pages.privacy', 'static.legal', 'static.privacy'],
    build: ['pages.privacy', 'static.privacy', 'static.legal', 'seo'],
  },
  '/salon-invitation': {
    client: ['salon.accept'],
    build: ['salon'],
  },
  '/salon/[id]': {
    client: [
      'galleryCard',
      'galleryFilter',
      'labels',
      'salon.profile',
      'stylist.actions',
      'stylist.cancelRequest',
      'stylist.contact',
    ],
    build: [],
  },
  '/site-map': {
    client: ['static.siteMap'],
    build: ['static.siteMap'],
  },
  '/status': {
    client: ['static.status'],
    build: ['static.status'],
  },
  '/stylist/[identifier]': {
    client: [
      'stylist.pairRequestConfirm',
      'components.outcomeFeedback',
      // The push soft ask under the request confirmation (notifications v2).
      'notifications.push',
      'notifications.softAsk',
      'galleryCard',
      'galleryFilter',
      'labels',
      'pages.gallery',
      'salon.profile',
      'share',
      'stylist.actions',
      'stylist.cancelRequest',
      'stylist.contact',
      'stylist.feedback',
      'stylist.gallery',
      'stylist.nameGate',
      'stylist.pairingExplainer',
      'stylist.profile',
      'stylist.stats',
    ],
    build: [],
  },
  '/terms': {
    client: ['pages.terms', 'static.legal', 'static.terms'],
    build: ['pages.terms', 'static.terms', 'static.legal', 'seo'],
  },
  '/welcome': {
    client: ['static.welcome'],
    build: ['static.welcome', 'seo'],
  },
} as const satisfies Record<string, PublicPageMessagesSpec>;
