import type { GetServerSidePropsContext } from 'next';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';
import { SessionDetailPageComposition } from '../../../../UI/features/sessions/SessionDetailPage.composition';

export default SessionDetailPageComposition;

export async function getServerSideProps({
  locale,
}: GetServerSidePropsContext) {
  const messages = await getI18nMessages(locale ?? 'pl', [
    'pages.sessions',
    'createSession',
    'galleryCard',
  ]);
  return { props: { messages } };
}
