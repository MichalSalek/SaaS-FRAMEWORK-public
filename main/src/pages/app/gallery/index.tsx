import type { NextPage, GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { GalleryPageComposition } from '../../../UI/features/gallery/GalleryPage.composition';

const Page: NextPage = () => <GalleryPageComposition />;

export default Page;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'pages.gallery',
    'galleryCard',
    'galleryFilter',
    'galleryStrength',
    'galleryQuickFilters',
    'galleryUI',
  ]);
  return { props: { messages } };
}
