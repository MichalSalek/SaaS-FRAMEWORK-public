/**
 * Sitemap-profiles unit tests — getSitemapProfiles_IO.
 *
 * The heavy lifting (visibility JOINs, is_hidden filter) lives in raw SQL — not
 * assertable through a mock. What IS behavior here and worth locking in:
 *
 *  - identifier = vanity_url with account_id fallback;
 *  - updated_at = latest VISIBLE record timestamp with account created_at
 *    fallback (stylist whose visible records all predate the account edge-case),
 *    serialized as ISO string;
 *  - DB failure → DATABASE_ERROR.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { getSitemapProfiles_IO } from './sitemap-profiles.operations';

type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: unknown): RawStub => fn as RawStub;

const LATEST_RECORD_AT = new Date('2026-06-01T12:00:00.000Z');
const ACCOUNT_CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

describe('getSitemapProfiles_IO — identifier + updated_at mapping', () => {
  it('maps rows: vanity_url preferred, account_id fallback; latest record date preferred, account created_at fallback', async () => {
    mockDb({
      $queryRaw: rawStub(
        vi.fn(async () => [
          {
            account_id: 'acc_test_0000000000000001',
            vanity_url: 'super-salon',
            account_created_at: ACCOUNT_CREATED_AT,
            latest_record_at: LATEST_RECORD_AT,
            record_count: 3n,
          },
          {
            account_id: 'acc_test_0000000000000002',
            vanity_url: null,
            account_created_at: ACCOUNT_CREATED_AT,
            latest_record_at: null,
            record_count: 1n,
          },
        ])
      ),
    });

    const result = await getSitemapProfiles_IO();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.profiles).toEqual([
        {
          identifier: 'super-salon',
          updated_at: LATEST_RECORD_AT.toISOString(),
        },
        {
          identifier: 'acc_test_0000000000000002',
          updated_at: ACCOUNT_CREATED_AT.toISOString(),
        },
      ]);
    }
  });

  it('empty result set → success with zero profiles', async () => {
    mockDb({ $queryRaw: rawStub(vi.fn(async () => [])) });

    const result = await getSitemapProfiles_IO();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.profiles).toEqual([]);
    }
  });

  it('DB throw → DATABASE_ERROR', async () => {
    mockDb({
      $queryRaw: rawStub(
        vi.fn(async () => {
          throw new Error('connection reset');
        })
      ),
    });

    const result = await getSitemapProfiles_IO();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});
