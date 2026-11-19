import type { GetStaticPropsContext } from 'next';
import { AccountRecoveryPageComposition } from '../../../../UI/features/account/AccountRecoveryPage.composition';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';

// Thin shell — the feature component carries its own <AppLayout> (the one
// canonical "who mounts the layout" pattern; see UI_ARCHITECTURE.md §Layout).
export default function RecoverPage() {
  return <AccountRecoveryPageComposition />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', ['account']);
  return { props: { messages } };
}
