import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';
import { CheckoutReturnPageComposition } from '../../../../UI/features/account/CheckoutReturnPage.composition';

// Thin shell — the feature component carries its own <AppLayout> (the one
// canonical "who mounts the layout" pattern; see UI_ARCHITECTURE.md §Layout).
export default function CheckoutReturnShellPage() {
  return <CheckoutReturnPageComposition />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale ?? 'pl', ['account']);
  return { props: { messages } };
}
