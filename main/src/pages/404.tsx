import type { GetStaticPropsContext } from 'next';
import { getPublicPageMessages } from '../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../application/i18n/page-messages.config';
import { resolveMsgKey } from '../application/i18n/resolve-msg-key';
import { NotFoundPageComposition } from '../UI/features/static/NotFoundPage.composition';
import { PublicSeoHeadComposition } from '../UI/components/PublicSeoHead/PublicSeoHead.composition';

interface NotFoundProps {
  seoTitle: string;
  seoDescription: string;
}

export default function NotFound({ seoTitle, seoDescription }: NotFoundProps) {
  return (
    <>
      <PublicSeoHeadComposition
        title={seoTitle}
        description={seoDescription}
        path='/404'
        noindex={true}
      />
      <NotFoundPageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const { messages, buildMessages } = await getPublicPageMessages(
    locale || 'pl',
    PUBLIC_PAGE_MESSAGES['/404']
  );
  return {
    props: {
      messages,
      seoTitle: resolveMsgKey(buildMessages, 'seo.notFound.title'),
      seoDescription: resolveMsgKey(buildMessages, 'seo.notFound.description'),
    },
  };
}
