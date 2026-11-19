import { expect, it, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const fetchPlans = vi.fn();
vi.mock('@app/stripe/pricing.operations', () => ({
  fetchPricingPlans: (...args: unknown[]) => fetchPlans(...args),
}));
import handler from '../../pages/api/v1/pricing/get-plans';

it.each([false, true])(
  'keeps a fallback catalog out of shared caches (fallback=%s)',
  async isFallback => {
    fetchPlans.mockResolvedValue({
      plans: [],
      currency: 'eur',
      is_fallback: isFallback,
      fetched_at: '2026-11-05T00:00:00.000Z',
    });
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      url: '/api/v1/pricing/get-plans',
      query: { currency: 'eur' },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(res.getHeader('Cache-Control')).toBe(
      isFallback
        ? 'private, no-store'
        : 'public, s-maxage=300, stale-while-revalidate=3600'
    );
  }
);
