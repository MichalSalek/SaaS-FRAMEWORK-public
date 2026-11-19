import type { GetStaticPropsContext } from 'next';
import { getPublicPageMessages } from '../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../application/i18n/page-messages.config';
import { resolveMsgKey } from '../application/i18n/resolve-msg-key';
import { PublicSeoHeadComposition } from '../UI/components/PublicSeoHead/PublicSeoHead.composition';
import { SiteMapPageComposition } from '../UI/features/static/SiteMapPage.composition';

export default function SiteMapPage({
  seoTitle,
  seoDescription,
}: {
  seoTitle: string;
  seoDescription: string;
}) {
  return (
    <>
      <PublicSeoHeadComposition title={seoTitle} description={seoDescription} />
      <SiteMapPageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const { messages, buildMessages } = await getPublicPageMessages(
    locale ?? 'pl',
    PUBLIC_PAGE_MESSAGES['/site-map']
  );
  return {
    props: {
      messages,
      seoTitle: resolveMsgKey(buildMessages, 'static.siteMap.seo.title'),
      seoDescription: resolveMsgKey(
        buildMessages,
        'static.siteMap.seo.description'
      ),
    },
    revalidate: 3600,
  };
}
