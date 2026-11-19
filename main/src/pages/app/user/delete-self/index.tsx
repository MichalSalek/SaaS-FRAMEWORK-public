import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';
import { DeleteSelfPageComposition } from '../../../../UI/features/auth/DeleteSelfPage.composition';

export default function DeleteSelfShell() {
  return <DeleteSelfPageComposition />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'pages.deleteSelf',
    'account',
  ]);
  return { props: { messages } };
}
