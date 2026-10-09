import type { GetServerSideProps } from 'next';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

// Legacy shim /help → /help-center. Locale-aware (S76): bez prefiksu locale
// user EN/DE trafiający na stary link /en/help lądował na POLSKIEJ wersji;
// defaultLocale (pl) zostaje bez prefiksu — parytet z routingiem Next.
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
