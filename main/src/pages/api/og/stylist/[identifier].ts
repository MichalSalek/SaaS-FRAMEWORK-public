import { resolveDefaultOgAsset } from '../../../../UI/assets/brandAssets';
/**
 * Dynamic OG image endpoint for stylist profiles.
 *
 * Route: GET /api/og/stylist/[identifier]
 * Output: 1200×630 PNG — branded Nailfolio card with stylist name, city, avatar.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Dynamic OG per stylist because a generic static /og-default.png gives zero
 * social signal for profile shares. Crawlers (Facebook, Twitter/X, LinkedIn,
 * WhatsApp, iMessage) fetch og:image server-side — this endpoint renders a
 * per-stylist card that includes the stylist name and city, improving CTR on
 * shared profiles and reinforcing per-stylist brand identity.
 *
 * Implementation uses `unstable_createNodejsStream` (Pages Router / Node.js
 * runtime). This avoids the Edge-only restriction of Next.js ImageResponse
 * while using the same compiled @vercel/og under the hood. The function name
 * has "unstable_" prefix per upstream naming — it is stable in practice for
 * server rendering; the prefix signals it may gain a stable alias in future
 * releases.
 *
 * Fallback: if the stylist is not found (404 from backend) or backend is
 * unavailable, returns a generic Nailfolio branded OG image (same dimensions,
 * same branding, no personal data).
 *
 * Cache: 10 min s-maxage + 30 min stale-while-revalidate (same as og-meta
 * endpoint on web-1, matched intentionally).
 *
 * JSX builders: see _og.builders.ts (split per max-lines rule).
 */

import type { NextApiRequest, NextApiResponse } from 'next';

// next/dist/compiled/@vercel/og/index.node is a CJS internal not exported from
// next's public types — typed locally via src/types/vercel-og-node.d.ts.
// Accessed directly per Next.js 16 Pages Router OG image pattern (edge-only
// ImageResponse does not work in Node.js API routes; unstable_createNodejsStream
// is the correct alternative).
import { unstable_createNodejsStream } from 'next/dist/compiled/@vercel/og/index.node';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import {
  buildGenericOgCard,
  buildStylistOgCard,
  OG_HEIGHT,
  OG_WIDTH,
  type StylistOgData,
} from './_og.builders';

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
    // DECISION (nie usuwaj tego komentarza):
    // GET_PUBLIC_PROFILE to QUERY (defineHandler method:'get', czyta qStr(req.query,
    // 'identifier')). Fetch MUSI być GET z identifier w query-stringu — POST+JSON-body
    // dawał 405 (HTTPRequestHandlerMiddleware twardo egzekwuje metodę), przez co KAŻDA
    // karta OG cicho degradowała do generycznej (buildGenericOgCard). Lustro kanonu SSR
    // w pages/stylist/[identifier].tsx.
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
    };
  } catch {
    return null;
  }
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

  const data = identifierStr ? await fetchStylistOgData(identifierStr) : null;

  const element = data ? buildStylistOgCard(data) : buildGenericOgCard();

  try {
    const stream = await unstable_createNodejsStream(element, {
      width: OG_WIDTH,
      height: OG_HEIGHT,
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
    // OG generation failure → redirect to static fallback rather than 500
    res.redirect(
      302,
      resolveDefaultOgAsset(
        req.query.locale === 'en' || req.query.locale === 'de'
          ? req.query.locale
          : 'pl'
      )
    );
  }
}
