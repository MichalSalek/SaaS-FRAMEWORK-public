import type { NextPage, GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';
import { SupportThreadsPageComposition } from '../../../../UI/features/support/SupportThreadsPage.composition';

const Page: NextPage = () => <SupportThreadsPageComposition />;

export default Page;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', ['pages.support']);
  return { props: { messages } };
}
