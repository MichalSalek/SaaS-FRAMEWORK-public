import type { NextApiRequest, NextApiResponse } from 'next';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import {
  probePublicDependencies,
  verifySyntheticMonitorSecret,
} from '../../../application/http/public-dependency-monitor';

/**
 * Composite synthetic monitor for public data mounted on static pages.
 * `/api/health/` remains the dependency-free frontend liveness signal; this
 * separate route returns 503 when any real public backend dependency fails.
 * Secret-gated because every check fans out to three DB-backed endpoints: an
 * unauthenticated route would be a public request-amplification primitive.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');

  const configuredSecret = process.env.INTERNAL_SHARED_SECRET;
  if (!configuredSecret) {
    res.status(503).json({ ok: false, service: 'public-dependencies' });
    return;
  }
  if (
    !verifySyntheticMonitorSecret(
      configuredSecret,
      req.headers[CUSTOM_HEADERS.xInternalSecret]
    )
  ) {
    // Opaque rejection: do not expose the existence/shape of an active DB probe.
    res.status(404).end();
    return;
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, service: 'public-dependencies' });
    return;
  }

  const health = await probePublicDependencies();
  res.status(health.ok ? 200 : 503).json({
    ...health,
    service: 'public-dependencies',
  });
}
