import Head from 'next/head';
import type { GetStaticProps } from 'next';
import { getI18nMessages } from '../../application/i18n/i18n.loader';
import { ARE_DEV_ROUTES_ENABLED } from '../../application/environment/environment.possibilities.api';
import { UiLibraryPageComposition } from '../../UI/features/ui-library/UiLibraryPage.composition';

/**
 * /dev/ui — biblioteka komponentów współdzielonych (dev-only + staging, noindex).
 * Katalog KLEPNIĘTYCH komponentów (soft-freeze): żywe rendery z realnych
 * importów + status FROZEN/DRAFT + "kiedy używać". Treść hardcode PL (narzędzie
 * robocze, bez i18n); messages w props potrzebne, bo PhoneMockup używa useTranslations.
 * Przeniesione z /ui pod /dev/ (2026-06-16).
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
