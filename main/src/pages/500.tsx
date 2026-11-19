import type { GetStaticPropsContext } from 'next';
import { getPublicPageMessages } from '../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../application/i18n/page-messages.config';
import { ServerErrorPageComposition } from '../UI/features/static/ServerErrorPage.composition';

export default function InternalServerError() {
  return <ServerErrorPageComposition />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const { messages } = await getPublicPageMessages(
    locale || 'pl',
    PUBLIC_PAGE_MESSAGES['/500']
  );
  return { props: { messages } };
}
