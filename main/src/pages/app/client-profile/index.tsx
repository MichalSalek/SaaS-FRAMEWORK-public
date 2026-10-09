import type { NextPage, GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { ClientProfilePageComposition } from '../../../UI/features/client/ClientProfilePage.composition';

const Page: NextPage = () => <ClientProfilePageComposition />;

export default Page;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  // `pages.pairing`: the stylist rows carry the shared „more” menu with
  // disconnecting, whose copy and success toast live in that namespace.
  const messages = await getI18nMessages(locale || 'pl', [
    'pages.clientProfile',
    'pages.pairing',
  ]);
  return { props: { messages } };
}
