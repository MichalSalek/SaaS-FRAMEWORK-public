import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';
import { AccountPageComposition } from '../../../../UI/features/account/AccountPage.composition';

export default function AccountShell() {
  return <AccountPageComposition />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'account',
    'validation',
  ]);
  return { props: { messages } };
}
