// UI/features/account/components/downgradeWarning.helpers.ts
// Pure selection of the loss lines shown before a move to Free Demo.
//
// DECISION: every line states only what a downgrade REALLY does (verified in web-1):
//  • gallery: records persist and paired clients keep seeing the whole gallery
//    (gallery-paired-client.operations.ts); Free only gates CREATING past the limit
//    (gallery-create.operation.ts, `count < max`);
//  • clients: pairs persist, Free only gates NEW pairings past the limit;
//  • pins: nothing is unpinned, but the public profile shows at most the plan's pin limit
//    (public-gallery-count.ts `resolvePublicGalleryCeiling`);
//  • watermark: `showWatermark` in gallery-public.operations.ts.
// Never phrase it as "Free pokazuje 5 prac": nothing in the gallery is hidden. `stats === null`
// means the counts are unknown (loading or failed): the count lines are omitted and the dialog
// falls back to the generic limit lines, so it never states a wrong number. A real 0 also omits
// the line (nothing to lose).

import {
  isUnlimitedLimit,
  PRICING_POLICY,
} from '@kernel/policies/pricing.policy';

export interface DowngradeWarningStats {
  galleryCount: number;
  pairedClientsCount: number;
  pinnedCount: number;
}

/** usage-stats response → dialog stats; undefined (loading, failed, disabled) → null. */
export const toDowngradeWarningStats = (
  usage:
    | {
        gallery_records: number;
        paired_clients: number;
        pinned_records: number;
      }
    | undefined
): DowngradeWarningStats | null =>
  usage
    ? {
        galleryCount: usage.gallery_records,
        pairedClientsCount: usage.paired_clients,
        pinnedCount: usage.pinned_records,
      }
    : null;

export type FreeDowngradeLoss =
  | { kind: 'gallery'; count: number; limit: number; remaining: number }
  | { kind: 'clients'; count: number; limit: number; remaining: number }
  | { kind: 'pinned'; count: number; limit: number }
  | { kind: 'watermark' }
  | { kind: 'galleryLimit'; limit: number };

const FREE_LIMITS = PRICING_POLICY.LIMITS.FREE;

export function resolveFreeDowngradeLosses(
  stats: DowngradeWarningStats | null,
  limits: {
    max_gallery_records: number;
    max_paired_clients: number;
    max_pinned_records: number;
  } = FREE_LIMITS
): FreeDowngradeLoss[] {
  const losses: FreeDowngradeLoss[] = [];
  const galleryLimit = limits.max_gallery_records;
  const clientsLimit = limits.max_paired_clients;
  const pinLimit = limits.max_pinned_records;

  let showGallery = false;
  if (
    stats !== null &&
    stats.galleryCount > 0 &&
    !isUnlimitedLimit(galleryLimit)
  ) {
    showGallery = true;
    losses.push({
      kind: 'gallery',
      count: stats.galleryCount,
      limit: galleryLimit,
      remaining: Math.max(0, galleryLimit - stats.galleryCount),
    });
  }

  if (
    stats !== null &&
    stats.pairedClientsCount > 0 &&
    !isUnlimitedLimit(clientsLimit)
  ) {
    losses.push({
      kind: 'clients',
      count: stats.pairedClientsCount,
      limit: clientsLimit,
      remaining: Math.max(0, clientsLimit - stats.pairedClientsCount),
    });
  }

  // Only a pin count ABOVE the ceiling changes what the public profile shows.
  if (
    stats !== null &&
    !isUnlimitedLimit(pinLimit) &&
    stats.pinnedCount > pinLimit
  ) {
    losses.push({ kind: 'pinned', count: stats.pinnedCount, limit: pinLimit });
  }

  losses.push({ kind: 'watermark' });

  // The gallery line already names the limit; repeating it read as a
  // contradiction (user-eyes review 2026-10-09), so the generic limit line
  // stands only when the gallery line does not.
  if (!showGallery && !isUnlimitedLimit(galleryLimit)) {
    losses.push({ kind: 'galleryLimit', limit: galleryLimit });
  }

  return losses;
}
