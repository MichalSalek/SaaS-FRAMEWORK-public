import type { NextPage, GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';
import { SupportNewThreadPageComposition } from '../../../../UI/features/support/SupportNewThreadPage.composition';

const Page: NextPage = () => <SupportNewThreadPageComposition />;

export default Page;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  // `validation.support`: the form shows the kernel validator's field messages.
  const messages = await getI18nMessages(locale || 'pl', [
    'pages.support',
    'validation.support',
  ]);
  return { props: { messages } };
}
