import type { GetServerSidePropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { MessageThreadPageComposition } from '../../../UI/features/messaging/MessageThreadPage.composition';

export default MessageThreadPageComposition;

export async function getServerSideProps({
  locale,
}: GetServerSidePropsContext) {
  const messages = await getI18nMessages(locale || 'pl', ['pages.messaging']);
  return { props: { messages } };
}
