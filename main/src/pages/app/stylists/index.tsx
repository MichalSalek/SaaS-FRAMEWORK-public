import { useEffect } from 'react';
import { useRouter } from 'next/router';
import type { GetStaticPropsContext } from 'next';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { usePublicFeatureFlag } from '../../../application/feature-flags/client-feature-flags';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { buildExploreTabHref } from '../../../UI/features/explore/exploreTab.query';

export default function StylistsPage() {
  const router = useRouter();
  // /app/stylists is a pure redirect into the discovery feed, opened on its
  // "Stylistki" tab (the route is "browse stylists"; landing on the default
  // "Stylizacje" tab made the drawer label lie, S122). When EXPLORE_ENABLED is
  // off (kernel default, parked) /app/explore 404s, so redirect to the dashboard
  // instead. Runtime-reactive: once an admin enables the flag the effect re-runs
  // (depends on exploreEnabled) and redirects into explore.
  const exploreEnabled = usePublicFeatureFlag(
    FEATURE_FLAG_KEYS.EXPLORE_ENABLED
  );

  useEffect(() => {
    void router.replace(
      exploreEnabled ? buildExploreTabHref('stylists') : ROUTES_FRONT.APP
    );
  }, [router, exploreEnabled]);

  return null;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', ['stylist']);
  return { props: { messages } };
}
