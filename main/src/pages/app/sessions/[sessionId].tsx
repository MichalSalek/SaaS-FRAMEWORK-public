import type { GetServerSidePropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { ClientSessionDetailPageComposition } from '../../../UI/features/sessions/ClientSessionDetailPage.composition';

export default ClientSessionDetailPageComposition;

export async function getServerSideProps({
  locale,
}: GetServerSidePropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'pages.sessions',
    'pages.sessionShare',
    'createSession',
    'galleryCard',
  ]);
  return { props: { messages } };
}
