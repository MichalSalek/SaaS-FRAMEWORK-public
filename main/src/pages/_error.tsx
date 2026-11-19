import type { NextPageContext } from 'next';
import { GenericErrorPageComposition } from '../UI/features/static/GenericErrorPage.composition';
import { getPublicPageMessages } from '../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../application/i18n/page-messages.config';

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
 * `getInitialProps` is required so Next can hydrate the status code on both server and client
 * paths; it also loads the i18n namespaces this page needs (`static.genericError` + buttons/layout
 * core).
 */
// The raw `err.message` deliberately does NOT reach the view: an SSR exception message (paths,
// module names, Prisma/fetch error text) is an internal detail.
const CustomErrorComponent = ({ statusCode }: CustomErrorProps) => {
  return <GenericErrorPageComposition statusCode={statusCode} />;
};

CustomErrorComponent.getInitialProps = async (ctx: NextPageContext) => {
  const statusCode = ctx.res?.statusCode ?? ctx.err?.statusCode ?? null;

  const locale = ctx.locale ?? 'pl';
  const { messages } = await getPublicPageMessages(
    locale,
    PUBLIC_PAGE_MESSAGES['/_error']
  );

  return {
    statusCode,
    messages,
  };
};

export default CustomErrorComponent;
