import type { GetStaticPropsContext } from 'next';
import Head from 'next/head';
import { useTranslations } from 'next-intl';
import { getI18nMessages } from '../../application/i18n/i18n.loader';
import { EmailUnsubscribePageComposition } from '../../UI/features/email/EmailUnsubscribePage.composition';

export default function EmailUnsubscribe() {
  // S76: title był hardcoded PL i renderował się też na /en i /de
  // (jedyna niezlokalizowana karta przeglądarki w audycie 38 stron).
  const t = useTranslations('pages.emailUnsubscribe');
  return (
    <>
      <Head>
        <title>{t('pageTitle')}</title>
        <meta name='robots' content='noindex,nofollow' />
      </Head>
      <EmailUnsubscribePageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale ?? 'pl', [
    'pages.emailUnsubscribe',
  ]);
  return { props: { messages } };
}
