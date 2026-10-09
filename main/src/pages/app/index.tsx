import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../application/i18n/i18n.loader';
import { DashboardPageComposition } from '../../UI/features/dashboard/DashboardPage.composition';

export default function AppDashboardPage() {
  return <DashboardPageComposition />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'dashboard',
    'pages.app',
    // Karta sily galerii na feedzie stylistki — bez tego namespace'u klucze
    // galleryStrength.* renderuja sie literalnie (census S26: karta widoczna
    // dopiero przy niepustym feedzie, stad luka przezyla do dzis).
    'galleryStrength',
  ]);
  return { props: { messages } };
}
