import type { GetServerSidePropsContext } from 'next';
import { useRouter } from 'next/router';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';
import { StylistGalleryPageComposition } from '../../../../UI/features/gallery/StylistGalleryPage.composition';

interface Props {
  stylistId: string;
}

export default function StylistGalleryShell({ stylistId }: Props) {
  const router = useRouter();
  const id =
    typeof router.query.id === 'string' && router.query.id.length > 0
      ? router.query.id
      : stylistId;
  return <StylistGalleryPageComposition stylistId={id} />;
}

export async function getServerSideProps({
  locale,
  params,
}: GetServerSidePropsContext) {
  const stylistId = params?.id as string | undefined;

  if (!stylistId) {
    return { notFound: true as const };
  }

  const messages = await getI18nMessages(locale ?? 'pl', [
    'pages.gallery',
    'galleryCard',
    'galleryFilter',
    'galleryStrength',
    'galleryQuickFilters',
    'galleryUI',
    'stylist',
  ]);
  return { props: { messages, stylistId } };
}
