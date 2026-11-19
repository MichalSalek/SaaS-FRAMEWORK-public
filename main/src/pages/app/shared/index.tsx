import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { SharedPageComposition } from '../../../UI/features/shared/SharedPage.composition';

export default SharedPageComposition;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'pages.shared',
    'createSession',
  ]);
  return { props: { messages } };
}
