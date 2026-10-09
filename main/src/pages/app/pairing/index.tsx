import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { PairingPageComposition } from '../../../UI/features/pairing/PairingPage.composition';

export default PairingPageComposition;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', ['pages.pairing']);
  return { props: { messages } };
}
