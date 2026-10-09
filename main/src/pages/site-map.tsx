import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../application/i18n/i18n.loader';
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
  const messages = await getI18nMessages(locale ?? 'pl', ['static.siteMap']);
  return {
    props: {
      messages,
      seoTitle: resolveMsgKey(messages, 'static.siteMap.seo.title'),
      seoDescription: resolveMsgKey(messages, 'static.siteMap.seo.description'),
    },
    revalidate: 3600,
  };
}
