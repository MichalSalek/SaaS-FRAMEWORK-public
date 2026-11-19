import Head from 'next/head';
import type { GetStaticProps } from 'next';
import { DevFilmsPageComposition } from '../../UI/features/dev/films/DevFilmsPage.composition';
import { IS_DEVELOPMENT_ENV } from '../../application/environment/environment.possibilities.api';
import { getI18nMessages } from '../../application/i18n/i18n.loader';

export default function Films() {
  return (
    <>
      <Head>
        <title>Filmy | Nailfolio Dev</title>
        <meta name='robots' content='noindex,nofollow' />
      </Head>
      <DevFilmsPageComposition />
    </>
  );
}

export const getStaticProps: GetStaticProps = async ({ locale }) => {
  if (!IS_DEVELOPMENT_ENV()) {
    return { notFound: true };
  }
  return { props: { messages: await getI18nMessages(locale ?? 'pl') } };
};
