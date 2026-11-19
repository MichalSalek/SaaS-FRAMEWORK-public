// UI/features/account/components/pinnedOrder.helpers.ts

/**
 * Index of the first pinned row the public profile no longer shows, or `null`
 * when every row is shown. The public read takes the pinned works in this same
 * order and cuts them at the plan's pin limit (resolvePublicGalleryCeiling in
 * web-1), so the cut lands exactly at `publicLimit`. `null` limit = not known
 * yet or unlimited: no cut is claimed.
 */
export function firstBeyondPublicLimit(
  total: number,
  publicLimit: number | null
): number | null {
  return publicLimit !== null && total > publicLimit ? publicLimit : null;
}
