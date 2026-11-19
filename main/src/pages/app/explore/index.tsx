import type { GetStaticPropsContext } from 'next';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { getFeatureFlagServerSide } from '../../../application/feature-flags/server-feature-flags';
import { ExplorePageComposition } from '../../../UI/features/explore/ExplorePage.composition';

export default function ExplorePageRoute() {
  return <ExplorePageComposition />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  // EXPLORE_ENABLED gate (kernel default OFF). ISR-revalidated so an admin runtime
  // toggle un-hides the route on the next regeneration without a rebuild — mirrors
  // the blog gate. When OFF the route 404s regardless of any stale bottom-nav link.
  const exploreEnabled = await getFeatureFlagServerSide(
    FEATURE_FLAG_KEYS.EXPLORE_ENABLED
  );
  if (!exploreEnabled) {
    return { notFound: true as const, revalidate: 300 };
  }

  const messages = await getI18nMessages(locale || 'pl', [
    'pages.explore',
    'galleryCard',
    'galleryFilter',
    'galleryQuickFilters',
    'galleryUI',
  ]);
  return { props: { messages }, revalidate: 300 };
}
