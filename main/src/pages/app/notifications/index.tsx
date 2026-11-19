import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { NotificationsPageComposition } from '../../../UI/features/notifications/NotificationsPage.composition';

export default NotificationsPageComposition;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  // `notifications` is a core namespace (the bell lives in AppLayout), so the
  // screen needs nothing beyond the core set.
  const messages = await getI18nMessages(locale || 'pl', []);
  return { props: { messages } };
}
