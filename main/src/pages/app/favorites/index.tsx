import type { NextPage, GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { FavoritesPageComposition } from '../../../UI/features/favorites/FavoritesPage.composition';

const Page: NextPage = () => <FavoritesPageComposition />;

export default Page;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'pages.favorites',
    'galleryCard',
  ]);
  return { props: { messages } };
}
