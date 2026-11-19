import type { GetStaticPropsContext } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { isRegisterIntent } from '../../UI/features/auth/LoginPage.helpers';
import { getI18nMessages } from '../../application/i18n/i18n.loader';
import { resolveMsgKey } from '../../application/i18n/resolve-msg-key';
import { LoginPageComposition } from '../../UI/features/auth/LoginPage.composition';

interface LoginProps {
  metaTitle: string;
}

/**
 * Login page — STANDALONE (no layout wrapper).
 *
 * Intentionally rendered WITHOUT PublicLayout — no header, no footer.
 * The full viewport is owned by LoginPage itself.
 *
 * `<title>` is set explicitly (noindex page, so PublicSeoHead's canonical/OG/hreflang would be
 * meaningless here). Without it document.title='' gives a blank browser tab and the Next.js
 * route-announcer reads the raw path '/user/login' to screen readers on client-side navigation.
 * Reuses the localized `pages.login.subtitle` key (no new i18n keys).
 */
export default function Login({ metaTitle }: LoginProps) {
  const router = useRouter();
  const t = useTranslations('pages.login');
  const title = isRegisterIntent(router.query['intent'])
    ? `${t('registerTitle')} | Nailfolio`
    : metaTitle;
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name='robots' content='noindex,nofollow' />
      </Head>
      <LoginPageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale ?? 'pl', [
    'pages.login',
    'validation',
  ]);
  const metaTitle = `${resolveMsgKey(messages, 'pages.login.subtitle')} | Nailfolio`;
  return { props: { messages, metaTitle } };
}
