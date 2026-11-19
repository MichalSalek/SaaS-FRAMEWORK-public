import type { GetStaticPropsContext } from 'next';
import Head from 'next/head';
import { useTranslations } from 'next-intl';
import { getPublicPageMessages } from '../../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../../application/i18n/page-messages.config';
import { EmailUnsubscribePageComposition } from '../../UI/features/email/EmailUnsubscribePage.composition';

export default function EmailUnsubscribe() {
  // The title must be localized: a hardcoded PL title also rendered on /en and /de.
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
  const { messages } = await getPublicPageMessages(
    locale ?? 'pl',
    PUBLIC_PAGE_MESSAGES['/email/unsubscribe']
  );
  return { props: { messages } };
}
