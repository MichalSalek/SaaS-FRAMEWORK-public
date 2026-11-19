import { resolveDefaultOgAsset } from '../../../../UI/assets/brandAssets';
import {
  resolveSeoLocale,
  seoFallbackName,
} from '../../../../UI/features/stylist/_seo.helpers';
/**
 * Dynamic OG image endpoint for stylist profiles.
 *
 * Route: GET /api/og/stylist/[identifier]
 * Output: 1200×630 PNG card with stylist name, city, avatar; filled with her brand accent when
 * her plan includes branding (ogCard.theme.ts), else the Nailfolio default. Per stylist because a
 * generic static /og-default.png gives zero social signal for profile shares.
 *
 * Uses `unstable_createNodejsStream` (Node.js runtime), loaded natively at request time (see
 * loadRenderer below); the "unstable_" prefix is upstream naming. Fallback (stylist not found or
 * backend down): a generic Nailfolio OG image, no personal data. Cache: 10 min s-maxage + 30 min
 * stale-while-revalidate (matches og-meta on web-1).
 * Card builders, theme and fonts live in UI/features/stylist/og/, NOT next to this file: every
 * module under pages/ is built as its own route, so helpers here would be served as endpoints.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import type { unstable_createNodejsStream as CreateNodejsStream } from 'next/dist/compiled/@vercel/og/index.node';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import {
  buildGenericOgCard,
  buildStylistOgCard,
  OG_HEIGHT,
  OG_WIDTH,
  type StylistOgData,
} from '../../../../UI/features/stylist/og/ogCard.builders';
import { loadOgFonts } from '../../../../UI/features/stylist/og/ogCard.fonts';

// ─── Backend URL resolution ───────────────────────────────────────────────────
// Matches getBackendUrl() in pages/stylist/[identifier].tsx — intentionally
// local to avoid coupling this API route to frontend domain layer utilities.
function resolveBackendUrl(): string {
  const protocol = process.env.NEXT_PUBLIC_HTTP_PROTOCOL ?? 'https://';
  const domain = process.env.NEXT_PUBLIC_BACKEND_PUBLIC_DOMAIN ?? '';
  const port = process.env.NEXT_PUBLIC_BACKEND_PUBLIC_PORT ?? '';
  if (!domain) {
    return '';
  }
  return `${protocol}${domain}${port ? `:${port}` : ''}`;
}

async function fetchStylistOgData(
  identifier: string
): Promise<StylistOgData | null> {
  const backendUrl = resolveBackendUrl();
  if (!backendUrl) {
    return null;
  }

  try {
    // DECISION: see main/src/pages/stylist/[identifier].tsx (GET_PUBLIC_PROFILE is a GET query with
    // `identifier` in the query string; POST+JSON got 405 and every OG card silently degraded).
    const url = `${backendUrl}${ROUTES_API.ACCOUNT_GET_PUBLIC_PROFILE}?identifier=${encodeURIComponent(identifier)}`;
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      return null;
    }

    const json = (await res.json()) as {
      data?: {
        account: {
          display_name: string | null;
          address_city: string | null;
          avatar_url: string | null;
          brand_accent_color?: string | null;
        };
      };
    };

    if (!json.data?.account) {
      return null;
    }

    return {
      display_name: json.data.account.display_name,
      address_city: json.data.account.address_city,
      avatar_url: json.data.account.avatar_url,
      // Already plan-masked by the backend; resolveOgTheme validates the hex.
      brand_accent_color: json.data.account.brand_accent_color ?? null,
    };
  } catch {
    return null;
  }
}

// ─── Renderer loading ────────────────────────────────────────────────────────

// DECISION: the renderer is loaded with a NATIVE dynamic import that the bundler must not touch,
// never with a static import. `next/dist/compiled/@vercel/og` is an ES module that reads its font and
// resvg.wasm at module evaluation through `fileURLToPath(new URL('./Geist-Regular.ttf',
// import.meta.url))`. A static import let the production webpack build bundle it into this route and
// rewrite that expression into webpack's `RelativeURL`, so `fileURLToPath` threw
// ERR_INVALID_ARG_TYPE while the route module loaded: every /api/og/* was a 500 before the handler
// ran, so the catch below never saw it. It is a bundling defect, not a host or missing-file one.
// Loaded natively, the module resolves from the standalone node_modules (copied by the
// outputFileTracingIncludes rule in next.config.mjs), `import.meta.url` is a real file URL, and a
// load failure lands in the handler's try → 302 to the static card. Do NOT turn this back into a
// static import.
type CreateNodejsStreamFn = typeof CreateNodejsStream;
let rendererPromise: Promise<CreateNodejsStreamFn> | null = null;
function loadRenderer(): Promise<CreateNodejsStreamFn> {
  if (rendererPromise === null) {
    rendererPromise = (
      import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ 'next/dist/compiled/@vercel/og/index.node.js'
      ) as Promise<{ unstable_createNodejsStream: CreateNodejsStreamFn }>
    ).then(
      mod => mod.unstable_createNodejsStream,
      (error: unknown) => {
        // Let the next request retry instead of caching a failed load.
        rendererPromise = null;
        throw error;
      }
    );
  }
  return rendererPromise;
}

// ─── API handler ─────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).end('Method Not Allowed');
    return;
  }

  const { identifier } = req.query;
  const identifierStr =
    typeof identifier === 'string' && identifier.length > 0 ? identifier : null;

  const locale = resolveSeoLocale(
    typeof req.query.locale === 'string' ? req.query.locale : undefined
  );
  const staticFallback = resolveDefaultOgAsset(locale);

  const data = identifierStr ? await fetchStylistOgData(identifierStr) : null;

  // The generic card is Polish copy; an EN or DE share without profile data
  // gets the static card of its own language instead.
  if (!data && locale !== 'pl') {
    res.redirect(302, staticFallback);
    return;
  }

  const element = data
    ? buildStylistOgCard(data, seoFallbackName(locale))
    : buildGenericOgCard();

  try {
    const [unstable_createNodejsStream, fonts] = await Promise.all([
      loadRenderer(),
      loadOgFonts(),
    ]);
    const stream = await unstable_createNodejsStream(element, {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      fonts,
    });

    // Cache 10 min, stale-while-revalidate 30 min — matches web-1 og-meta endpoint
    res.setHeader('Content-Type', 'image/png');
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=600, stale-while-revalidate=1800'
    );
    res.status(200);
    stream.pipe(res);
  } catch {
    // Renderer, font or render failure → static card rather than 500
    res.redirect(302, staticFallback);
  }
}
