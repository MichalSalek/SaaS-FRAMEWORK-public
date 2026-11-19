import type { GetServerSideProps } from 'next';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

// Legacy shim /help → /help-center. Locale-aware: without the locale prefix an EN/DE user opening
// the old /en/help link landed on the POLISH version; defaultLocale (pl) stays unprefixed, in
// parity with Next routing.
export const getServerSideProps: GetServerSideProps = async ({
  locale,
  defaultLocale,
}) => {
  const prefix =
    locale !== undefined && locale !== defaultLocale ? `/${locale}` : '';
  return {
    redirect: {
      destination: `${prefix}${ROUTES_FRONT.HELP_CENTER}`,
      permanent: true,
    },
  };
};

export default function Help() {
  return null;
}
