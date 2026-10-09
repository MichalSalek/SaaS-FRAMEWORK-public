import type { GetServerSidePropsContext } from 'next';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';
import { SupportThreadDetailPageComposition } from '../../../../UI/features/support/SupportThreadDetailPage.composition';

export default SupportThreadDetailPageComposition;

export async function getServerSideProps({
  locale,
}: GetServerSidePropsContext) {
  const messages = await getI18nMessages(locale || 'pl', ['pages.support']);
  return { props: { messages } };
}
