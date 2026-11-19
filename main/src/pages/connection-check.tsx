import type { GetStaticPropsContext } from 'next';
import { getPublicPageMessages } from '../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../application/i18n/page-messages.config';
import { PublicSeoHeadComposition } from '../UI/components/PublicSeoHead/PublicSeoHead.composition';
import { ConnectionCheckPageComposition } from '../UI/features/static/ConnectionCheckPage.composition';

export default function ConnectionCheck() {
  return (
    <>
      {/* Meta is PL-only on purpose: a diagnostic/internal (noindex) page, not a public SEO surface,
       * so extracting it to seo.* i18n is not worth the overhead. */}
      <PublicSeoHeadComposition
        title='Sprawdzenie połączenia'
        description='Strona diagnostyczna Nailfolio: status frontendu, backendu i sesji.'
        path='/connection-check'
        noindex
      />
      <ConnectionCheckPageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const { messages } = await getPublicPageMessages(
    locale ?? 'pl',
    PUBLIC_PAGE_MESSAGES['/connection-check']
  );
  return { props: { messages }, revalidate: 3600 };
}
