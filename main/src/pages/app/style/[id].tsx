import type { GetServerSidePropsContext } from 'next';
import { useRouter } from 'next/router';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { getFeatureFlagServerSide } from '../../../application/feature-flags/server-feature-flags';
import { StyleDetailPageComposition } from '../../../UI/features/gallery/StyleDetailPage.composition';

interface Props {
  styleId: string;
}

export default function StyleDetailShell({ styleId }: Props) {
  const router = useRouter();
  const id =
    typeof router.query.id === 'string' && router.query.id.length > 0
      ? router.query.id
      : styleId;
  return <StyleDetailPageComposition styleId={id} />;
}

export async function getServerSideProps({
  locale,
  params,
}: GetServerSidePropsContext) {
  const styleId = params?.id as string | undefined;

  if (!styleId) {
    return { notFound: true as const };
  }

  // Widok "prace w tym stylu" zasila publiczny EXPLORE (cross-stylist discovery).
  // Gdy EXPLORE_ENABLED=false (cold-start) explore-API zwraca 404 -> strona
  // pokazywalaby blad zamiast czystego stanu. Spojnie z /app/explore + /app/stylists:
  // gate na fladze -> notFound gdy off.
  const exploreEnabled = await getFeatureFlagServerSide(
    FEATURE_FLAG_KEYS.EXPLORE_ENABLED
  );
  if (!exploreEnabled) {
    return { notFound: true as const };
  }

  const messages = await getI18nMessages(locale ?? 'pl', [
    'pages.gallery',
    'galleryCard',
    'galleryStrength',
    'galleryFilter',
  ]);
  return { props: { messages, styleId } };
}
