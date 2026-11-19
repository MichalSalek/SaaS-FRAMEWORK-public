import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../application/i18n/i18n.loader';
import { DashboardPageComposition } from '../../UI/features/dashboard/DashboardPage.composition';

export default function AppDashboardPage() {
  return <DashboardPageComposition />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'dashboard',
    'account.profile',
    'account.profileManage',
    'pages.app',
    // Gallery strength card on the stylist feed: without this namespace the galleryStrength.* keys
    // render literally (the card shows only with a non-empty feed, so the gap is easy to miss).
    'galleryStrength',
    // Client and stylist rows say so when the other account is gone.
    'pages.pairing',
  ]);
  return { props: { messages } };
}
