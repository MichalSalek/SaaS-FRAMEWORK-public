import type { GetServerSidePropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { ClientSessionsPageComposition } from '../../../UI/features/sessions/ClientSessionsPage.composition';

export default ClientSessionsPageComposition;

export async function getServerSideProps({
  locale,
}: GetServerSidePropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'pages.sessions',
    'createSession',
  ]);
  return { props: { messages } };
}
