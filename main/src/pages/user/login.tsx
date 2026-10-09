import type { GetStaticPropsContext } from 'next';
import Head from 'next/head';
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
 * DECISION (nie usuwaj tego komentarza):
 * `<title>` set explicitly (noindex page → PublicSeoHead's canonical/OG/hreflang
 * would be meaningless here). Without it document.title='' → (1) blank browser
 * tab, (2) Next.js route-announcer leaks the raw path '/user/login' to screen
 * readers on client-side nav (same class as S60a authed-shell fix). Reuses the
 * existing localized `pages.login.subtitle` key (zero new i18n keys).
 */
export default function Login({ metaTitle }: LoginProps) {
  return (
    <>
      <Head>
        <title>{metaTitle}</title>
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
