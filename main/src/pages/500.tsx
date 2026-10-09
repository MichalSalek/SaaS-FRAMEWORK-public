import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../application/i18n/i18n.loader';
import { ServerErrorPageComposition } from '../UI/features/static/ServerErrorPage.composition';

export default function InternalServerError() {
  return <ServerErrorPageComposition />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', ['pages.serverError']);
  return { props: { messages } };
}
