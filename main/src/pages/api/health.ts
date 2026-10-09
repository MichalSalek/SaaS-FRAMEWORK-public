import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Lekki health-check frontu nailfolio dla uptime monitorów / status page.
 * Front żyje na hostingu always-on (nie usypia) — to czysty sygnał "front oddycha":
 * zero zależności (brak fetcha do backendu/Stripe), więc nie failuje przy cudzym outage.
 * Backend ma własny /api/v1/internal/health-public. trailingSlash:true → monitor pinguje /api/health/.
 * Rewrites (/api/v1/*, /api/auth/*) NIE łapią /api/health → route zostaje lokalny dla frontu.
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  res
    .status(200)
    .json({ ok: true, service: 'nailfolio-frontend', ts: Date.now() });
}
