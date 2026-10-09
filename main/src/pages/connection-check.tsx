import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../application/i18n/i18n.loader';
import { PublicSeoHeadComposition } from '../UI/components/PublicSeoHead/PublicSeoHead.composition';
import { ConnectionCheckPageComposition } from '../UI/features/static/ConnectionCheckPage.composition';

export default function ConnectionCheck() {
  return (
    <>
      {/* DECISION (nie usuwaj tego komentarza):
       * Meta PL-only celowo — strona diagnostyczna/wewnętrzna (noindex), nie publiczna powierzchnia SEO.
       * Brak ekstrakcji do seo.* i18n jest świadomy (i18n overhead nieuzasadniony dla dev-tool). */}
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
  const messages = await getI18nMessages(locale ?? 'pl', [
    'pages.connectionCheck',
  ]);
  return { props: { messages }, revalidate: 3600 };
}
