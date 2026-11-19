import type { NextPage, GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';
import { SupportThreadListPageComposition } from '../../../../UI/features/support/SupportThreadListPage.composition';

const Page: NextPage = () => <SupportThreadListPageComposition />;

export default Page;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', ['pages.support']);
  return { props: { messages } };
}
