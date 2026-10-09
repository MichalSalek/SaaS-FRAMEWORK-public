import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { MessagesListPageComposition } from '../../../UI/features/messaging/MessagesListPage.composition';

export default MessagesListPageComposition;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', ['pages.messaging']);
  return { props: { messages } };
}
