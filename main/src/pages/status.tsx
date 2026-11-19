import type {
  GetServerSidePropsContext,
  InferGetServerSidePropsType,
} from 'next';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { getPublicPageMessages } from '../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../application/i18n/page-messages.config';
import { formatDateLong } from '../application/date/date.utils';
import { ENV_VARS } from '../application/environment/environment.config';
import { StatusPageComposition } from '../UI/features/static/StatusPage.composition';
import { PublicSeoHeadComposition } from '../UI/components/PublicSeoHead/PublicSeoHead.composition';

/**
 * DECISION: /status uses getServerSideProps (SSR), NOT getStaticProps. The health probe hits
 * /api/v1/internal/health-public, the ONE v1 endpoint that bypasses the HTTPRequestHandlerMiddleware
 * and therefore has NO CORS headers. A client-side fetch would be blocked by the browser and falsely
 * report a full outage. SSR runs Node→Node, which never touches CORS, so the probe always reaches
 * the backend. The endpoint is no-auth (no Bearer needed). noindex stays: this is an operational
 * page, not SEO content.
 */

function getBackendUrl(): string {
  const port = ENV_VARS.NEXT_PUBLIC_BACKEND_PUBLIC_PORT;
  return `${ENV_VARS.NEXT_PUBLIC_HTTP_PROTOCOL}${ENV_VARS.NEXT_PUBLIC_BACKEND_PUBLIC_DOMAIN}${port ? `:${port}` : ''}`;
}

type HealthState = {
  database: 'up' | 'down';
  api: 'up' | 'down';
};

type HealthPublicResponse = {
  event: string;
  data: {
    database: 'up' | 'down';
    api: 'up' | 'down';
    uptime_seconds: number;
    ts: string;
  };
};

export default function Status({
  health,
  lastCheckedAtLabel,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return (
    <>
      {/* Meta is PL-only on purpose: a diagnostic/internal (noindex) page, not a public SEO surface,
       * so extracting it to seo.* i18n is not worth the overhead. */}
      <PublicSeoHeadComposition
        title='Status systemu'
        description='Status usług Nailfolio.'
        path='/status'
        noindex
      />
      <StatusPageComposition
        health={health}
        lastCheckedAtLabel={lastCheckedAtLabel}
      />
    </>
  );
}

export async function getServerSideProps({
  locale,
}: GetServerSidePropsContext) {
  const { messages } = await getPublicPageMessages(
    locale || 'pl',
    PUBLIC_PAGE_MESSAGES['/status']
  );

  let health: HealthState | null = null;

  try {
    const url = `${getBackendUrl()}${ROUTES_API.INTERNAL_HEALTH_PUBLIC}`;
    // AbortController timeout — the status page must never hang or 500 when the
    // backend is unreachable; a failed probe degrades gracefully to health=null.
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 4000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      if (response.ok) {
        const json = (await response.json()) as HealthPublicResponse;
        health = { database: json.data.database, api: json.data.api };
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Backend unreachable / timeout / non-OK — render the page in a degraded
    // (unknown) state instead of a hard outage or a 500.
    health = null;
  }

  return {
    props: {
      messages,
      health,
      /* The label is formatted HERE (SSR), not in the component: the same string in the server HTML
       * and during hydration. Formatting at render time (Intl + new Date on the client) gave a
       * hydration text mismatch when SSR and client had a different date/ICU. */
      lastCheckedAtLabel: formatDateLong(
        new Date().toISOString(),
        locale || 'pl'
      ),
    },
  };
}
