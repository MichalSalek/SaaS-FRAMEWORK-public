import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../../../application/i18n/i18n.loader';
import { AccountPayPageComposition } from '../../../../../UI/features/account/AccountPayPage.composition';

export default function AccountPayShell() {
  return <AccountPayPageComposition />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'account',
    'static.pricing',
    'validation',
  ]);
  return { props: { messages } };
}
