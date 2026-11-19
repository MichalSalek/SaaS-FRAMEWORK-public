import { describe, expect, it } from 'vitest';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import {
  resolveFreeDowngradeLosses,
  toDowngradeWarningStats,
} from './downgradeWarning.helpers';

const FREE = PRICING_POLICY.LIMITS.FREE;
const kinds = (l: ReturnType<typeof resolveFreeDowngradeLosses>) =>
  l.map(x => x.kind);

describe('resolveFreeDowngradeLosses', () => {
  it('unknown counts (loading or failed) give only the generic lines', () => {
    expect(kinds(resolveFreeDowngradeLosses(null))).toEqual([
      'watermark',
      'galleryLimit',
    ]);
  });

  it('real zeros omit the count lines and keep the generic limit line', () => {
    expect(
      kinds(
        resolveFreeDowngradeLosses({
          galleryCount: 0,
          pairedClientsCount: 0,
          pinnedCount: 0,
        })
      )
    ).toEqual(['watermark', 'galleryLimit']);
  });

  it('over the limits: the exact counts, no room left, pins above the public ceiling', () => {
    const losses = resolveFreeDowngradeLosses({
      galleryCount: 12,
      pairedClientsCount: 7,
      pinnedCount: 8,
    });
    expect(losses).toEqual([
      {
        kind: 'gallery',
        count: 12,
        limit: FREE.max_gallery_records,
        remaining: 0,
      },
      {
        kind: 'clients',
        count: 7,
        limit: FREE.max_paired_clients,
        remaining: 0,
      },
      { kind: 'pinned', count: 8, limit: FREE.max_pinned_records },
      { kind: 'watermark' },
    ]);
  });

  it('under the limits: the room that is left, and no pin line', () => {
    const losses = resolveFreeDowngradeLosses({
      galleryCount: 2,
      pairedClientsCount: 1,
      pinnedCount: FREE.max_pinned_records,
    });
    expect(losses).toEqual([
      {
        kind: 'gallery',
        count: 2,
        limit: FREE.max_gallery_records,
        remaining: FREE.max_gallery_records - 2,
      },
      {
        kind: 'clients',
        count: 1,
        limit: FREE.max_paired_clients,
        remaining: FREE.max_paired_clients - 1,
      },
      { kind: 'watermark' },
    ]);
  });

  it('exactly at the limit leaves no room', () => {
    const [gallery] = resolveFreeDowngradeLosses({
      galleryCount: FREE.max_gallery_records,
      pairedClientsCount: 0,
      pinnedCount: 0,
    });
    expect(gallery).toMatchObject({ kind: 'gallery', remaining: 0 });
  });

  it('an unlimited target limit never produces a count line', () => {
    expect(
      kinds(
        resolveFreeDowngradeLosses(
          { galleryCount: 40, pairedClientsCount: 9, pinnedCount: 60 },
          {
            max_gallery_records: -1,
            max_paired_clients: -1,
            max_pinned_records: -1,
          }
        )
      )
    ).toEqual(['watermark']);
  });
});

describe('toDowngradeWarningStats', () => {
  it('missing usage (loading, failed, disabled) is unknown, not zero', () => {
    expect(toDowngradeWarningStats(undefined)).toBeNull();
  });

  it('maps the usage counts one to one', () => {
    expect(
      toDowngradeWarningStats({
        gallery_records: 12,
        paired_clients: 3,
        pinned_records: 8,
      })
    ).toEqual({ galleryCount: 12, pairedClientsCount: 3, pinnedCount: 8 });
  });
});
