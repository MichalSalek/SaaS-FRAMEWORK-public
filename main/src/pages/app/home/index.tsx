import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { AppHomePageComposition } from '../../../UI/features/app-home/AppHomePage.composition';

export default AppHomePageComposition;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'pages.appHome',
    // Baner = ten sam GetAppHero co na /get-app: hero.* żyje w static.getApp,
    // a etykieta drugiego telefonu (ekran QR) w pages.home.benefits.
    'static.getApp',
    'pages.home',
  ]);
  return { props: { messages } };
}
