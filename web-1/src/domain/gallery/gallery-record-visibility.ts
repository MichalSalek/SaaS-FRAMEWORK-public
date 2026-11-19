import type { Prisma } from '../../prisma/js-client';

import { resolveSalonAccess_IO } from '@domain/pairing/salon-access.resolver';
import type { IDType } from '@kernel/application/application.types';
import { isAccountActive } from '@domain/account/account.config';

/**
 * Per-record visibility gate: may THIS viewer see THIS gallery record?
 *
 * One predicate for every endpoint that takes a gallery_record_id from a logged user
 * (RBAC=LOGGED_USER) and must not act on a record the viewer cannot see: get-by-id
 * (gallery-detail.query.ts) and report-abuse (moderation-report.operation.ts). A caller
 * collapses a `false` into the same GALLERY_RECORD_NOT_FOUND it returns for a
 * nonexistent id, so the gate is never an existence oracle.
 */

/**
 * "Visible pinned records" = exactly what the public profile shows and what the
 * plan's pin quota counts. ONE where-fragment for every pin COUNT (pin gate + its
 * recount, unpin response, dashboard `pinned_count`, usage-stats `pinned_records`)
 * and for the public pinned-gallery read, so the number the owner sees, the number
 * the gate enforces and the works the public sees cannot drift apart. A record
 * hidden by moderation after being pinned stays `is_pinned` in the DB but frees
 * its slot (DECISION in gallery-pin.operations.ts). Spread it into a `where`.
 */
export const VISIBLE_PINNED_GALLERY_RECORD_WHERE = {
  is_pinned: true,
  is_hidden: false,
} as const;

/**
 * Order of pinned works on every public surface (profile gallery, sample photos on
 * list cards, JSON-LD `pinned_photo_urls`) and in the owner's pin manager: the
 * stylist's chosen position first, then the old order (newest first) for a pinned
 * record without a position (pinned before the column existed, or by the demo
 * seeder). The cuid tiebreaker keeps offset pagination stable. One constant so the
 * order she sets in the manager is exactly the order a stranger sees.
 */
export const PINNED_GALLERY_RECORD_ORDER_BY: Prisma.GalleryRecordOrderByWithRelationInput[] =
  [
    { pinned_position: { sort: 'asc', nulls: 'last' } },
    { created_at: 'desc' },
    { gallery_record_id: 'desc' },
  ];

/** Columns the gate reads. Spread into a `select`, or covered by an `include` superset. */
export const GALLERY_RECORD_VISIBILITY_SELECT = {
  is_hidden: true,
  is_pinned: true,
  created_by_account: {
    select: {
      account_id: true,
      created_by_user_id: true,
      account_status: true,
      created_by_user: { select: { is_active: true } },
    },
  },
} as const;

type GalleryRecordVisibilityFacts = Prisma.GalleryRecordGetPayload<{
  select: typeof GALLERY_RECORD_VISIBILITY_SELECT;
}>;

export const isGalleryRecordVisibleToViewer = async (
  record: GalleryRecordVisibilityFacts,
  /** viewerUserId = currentUser.id (User.id from the session) */
  viewerUserId: IDType
): Promise<boolean> => {
  const isOwner = record.created_by_account.created_by_user_id === viewerUserId;

  // OWNER-BYPASS (user-level): the owner still sees her own record when it is hidden,
  // unpinned or her own account is disabled. That is not a leak (she sees only her own)
  // and it keeps the guards below consistent with each other.
  if (isOwner) {
    return true;
  }

  // DECISION: records hidden by moderation (HIDE) or belonging to a banned stylist (BAN sets
  // is_hidden=true) are not fetchable by ID for non-owners. The endpoint is RBAC=LOGGED_USER, so without
  // this any logged-in user could read the asset_url and stylist_info of a hidden record. The owner
  // (isOwner, user-level) still sees their own hidden record on purpose.
  if (record.is_hidden) {
    return false;
  }

  // DECISION: records of a stylist with a non-ACTIVE account or an inactive user (soft-delete,
  // DOMAIN_SSOT §13.1) are not fetchable by ID for non-owners (mirror of gallery-explore.query.ts and the
  // public profile), answered with NOT_FOUND rather than 403 so existence does not leak. This is the same
  // pair as STYLIST_PUBLICLY_VISIBLE (account.config.ts) as a JS boolean, because the owner-bypass branch
  // needs the values: callers fetch the record unconditionally, then this gates non-owners.
  const isStylistVisible =
    isAccountActive(record.created_by_account.account_status) &&
    record.created_by_account.created_by_user.is_active;
  if (!isStylistVisible) {
    return false;
  }

  // DECISION: non-pinned content is pairing-gated (DOMAIN_SSOT §4.1/§4.2: only is_pinned=true works
  // are public). findUnique reads by ID unconditionally on a LOGGED_USER endpoint, so without this gate
  // any unpaired stranger who knew an ID got asset_url and stylist_info (IDOR plus enumeration). A
  // non-owner needs is_pinned===true or an ACTIVE client<->stylist pair (same as gallery-public and
  // gallery-paired-client); revoked or pending pairs grant nothing. Failure is GALLERY_RECORD_NOT_FOUND
  // (404) to avoid leaking existence.
  if (record.is_pinned) {
    return true;
  }
  return Boolean(
    await resolveSalonAccess_IO(
      viewerUserId,
      record.created_by_account.account_id
    )
  );
};
