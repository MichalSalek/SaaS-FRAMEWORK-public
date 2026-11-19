import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { AppHomePageComposition } from '../../../UI/features/app-home/AppHomePage.composition';

export default AppHomePageComposition;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'pages.appHome',
    // The banner is the same GetAppHero as on /get-app: hero.* lives in static.getApp, and the
    // label of the second phone (QR screen) in pages.home.benefits.
    'static.getApp',
    'pages.home',
  ]);
  return { props: { messages } };
}
