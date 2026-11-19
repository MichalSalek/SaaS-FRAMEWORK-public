import Head from 'next/head';
import type { GetStaticProps } from 'next';
import { getI18nMessages } from '../../application/i18n/i18n.loader';
import { ARE_DEV_ROUTES_ENABLED } from '../../application/environment/environment.possibilities.api';
import { UiLibraryPageComposition } from '../../UI/features/ui-library/UiLibraryPage.composition';

/**
 * /dev/ui: library of shared components (dev-only + staging, noindex).
 * A catalogue of APPROVED components (soft freeze): live renders from the real imports, a
 * FROZEN/DRAFT status and "when to use". Content is hardcoded PL (internal tool, no i18n);
 * messages in props are needed because PhoneMockup uses useTranslations.
 */
export default function DevUi() {
  return (
    <>
      <Head>
        <title>Biblioteka UI</title>
        <meta name='robots' content='noindex,nofollow' />
      </Head>
      <UiLibraryPageComposition />
    </>
  );
}

export const getStaticProps: GetStaticProps = async ({ locale }) => {
  if (!ARE_DEV_ROUTES_ENABLED()) {
    return { notFound: true };
  }
  const resolved = locale ?? 'pl';
  const messages = await getI18nMessages(resolved);
  return { props: { messages } };
};
