import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../application/i18n/i18n.loader';
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
  const messages = await getI18nMessages(locale || 'pl', [
    'static.notFound',
    'seo',
  ]);
  return {
    props: {
      messages,
      seoTitle: resolveMsgKey(messages, 'seo.notFound.title'),
      seoDescription: resolveMsgKey(messages, 'seo.notFound.description'),
    },
  };
}
