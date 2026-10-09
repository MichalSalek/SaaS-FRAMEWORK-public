import type { NextPageContext } from 'next';
import { GenericErrorPageComposition } from '../UI/features/static/GenericErrorPage.composition';
import { getI18nMessages } from '../application/i18n/i18n.loader';

interface CustomErrorProps {
  statusCode: number | null;
  messages?: unknown;
}

/**
 * Pages Router catch-all error page.
 *
 * Renders for arbitrary server-side / runtime errors that are NOT
 * specifically 404 (which has its own `404.tsx`) or 500 (which has
 * its own `500.tsx`). Brand-coherent fallback, not the bare Next.js
 * default `<Error />` component.
 *
 * DECISION (nie usuwaj tego komentarza):
 * `getInitialProps` is required so Next can hydrate the status code
 * on both server and client paths. We extend the default behaviour by
 * also loading the i18n namespaces this page needs (`static.genericError`
 * + buttons/layout core).
 */
// Surowy `err.message` celowo NIE trafia do widoku: komunikat wyjątku z SSR
// (ścieżki, nazwy modułów, treść błędów Prisma/fetch) to szczegół wewnętrzny.
const CustomErrorComponent = ({ statusCode }: CustomErrorProps) => {
  return <GenericErrorPageComposition statusCode={statusCode} />;
};

CustomErrorComponent.getInitialProps = async (ctx: NextPageContext) => {
  const statusCode = ctx.res?.statusCode ?? ctx.err?.statusCode ?? null;

  const locale = ctx.locale ?? 'pl';
  const messages = await getI18nMessages(locale, ['static.genericError']);

  return {
    statusCode,
    err: ctx.err ? { message: ctx.err.message } : null,
    messages,
  };
};

export default CustomErrorComponent;
