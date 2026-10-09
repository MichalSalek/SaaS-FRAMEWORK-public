import type { NextPage, GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';
import { UploadAssetPageComposition } from '../../../../UI/features/gallery/UploadAssetPage.composition';

const Page: NextPage = () => <UploadAssetPageComposition />;

export default Page;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'pages.gallery',
    'validation',
    'galleryStrength',
    'galleryFilter',
    'galleryCard',
    'galleryQuickFilters',
    'galleryUI',
  ]);
  return { props: { messages } };
}
