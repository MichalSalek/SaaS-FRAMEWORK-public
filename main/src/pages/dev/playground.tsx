import Head from 'next/head';
import type { GetStaticProps } from 'next';
import { getI18nMessages } from '../../application/i18n/i18n.loader';
import { ARE_DEV_ROUTES_ENABLED } from '../../application/environment/environment.possibilities.api';
import { PlaygroundComposition } from '../../UI/features/dev/playground/Playground.composition';

/** Owner-vote workshop. Dev and staging only; a vote never ships by itself. */
export default function DevPlayground() {
  return (
    <>
      <Head>
        <title>Playground: głosowania Nailfolio</title>
        <meta name='robots' content='noindex,nofollow' />
      </Head>
      <PlaygroundComposition />
    </>
  );
}

export const getStaticProps: GetStaticProps = async ({ locale }) => {
  if (!ARE_DEV_ROUTES_ENABLED()) {
    return { notFound: true };
  }
  const messages = await getI18nMessages(locale ?? 'pl');
  return { props: { messages } };
};
