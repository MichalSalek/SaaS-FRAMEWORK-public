import { describe, expect, it } from 'vitest';
import { sanitizeObservationUrl } from './observation-url';

describe('observation URL redaction', () => {
  it.each([
    '/api/v1/public/newsletter-confirm/one-time-secret?locale=pl#token',
    'https://nailfolio.app/api/v1/public/newsletter-confirm/one-time-secret?locale=pl',
    '/api/v1/public/newsletter-confirm/token%2Fencoded',
  ])('redacts a path token from %s', value => {
    const safe = sanitizeObservationUrl(value);
    expect(safe).toContain('/newsletter-confirm/[REDACTED]');
    expect(safe).not.toContain('one-time-secret');
    expect(safe).not.toContain('token%2Fencoded');
    expect(safe).not.toContain('?');
  });
  it('preserves diagnostic paths but strips secret query and fragment values', () => {
    expect(
      sanitizeObservationUrl('/api/auth/magic-link/verify?token=secret#other')
    ).toBe('/api/auth/magic-link/verify');
    expect(sanitizeObservationUrl('/api/v1/session/get-current')).toBe(
      '/api/v1/session/get-current'
    );
  });
});
