/**
 * ADMIN USER-MANAGEMENT unit tests — adminDeleteUserAny_IO (sibling of
 * admin-user-management.operations.test.ts; split for the max-lines budget,
 * same seams — see that file's header for the shared setup rationale).
 *
 * Behavior under test — terminal admin hard-delete:
 *  - unknown target → ADMIN_TARGET_NOT_FOUND, nothing canceled/deleted;
 *  - happy path ordering: Stripe subscription cancel → bounded, account-scoped
 *    Cloudinary asset collection → self-protecting archive (DeletedUser.upsert
 *    with is_gdpr_erased=true on BOTH branches, in the SAME tx as the delete —
 *    admin takedown is not silently reversible) → target-side impersonation
 *    backup cleanup → user.delete scoped by id → GDPR newsletter cleanup by the
 *    PRE-CAPTURED email → Cloudinary cleanup (gallery + visit photos) → audit
 *    USER_DELETED;
 *  - zero assets → Cloudinary cleanup not invoked.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  makeStylistCurrentUser,
  makeUser,
  makeStylistAccount,
} from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import type {
  StylistAccount,
  User,
} from '@kernel/models/db_models.generated.dto';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

const { cancelStripeSubscriptionIfExists } = vi.hoisted(() => ({
  cancelStripeSubscriptionIfExists: vi.fn(async (_arg: unknown) => undefined),
}));
vi.mock('@app/stripe/customer.operations', () => ({
  cancelStripeSubscriptionIfExists,
}));

const { cleanupCloudinaryAssets } = vi.hoisted(() => ({
  cleanupCloudinaryAssets: vi.fn(),
}));
vi.mock('@domain/gallery/operations/gallery-cloudinary-cleanup', () => ({
  cleanupCloudinaryAssets,
}));

const { collectVisitResultPhotoUrlsForUser_IO } = vi.hoisted(() => ({
  collectVisitResultPhotoUrlsForUser_IO: vi.fn(
    async (): Promise<string[]> => []
  ),
}));
vi.mock('@domain/visit/operations/visit-result-photo.operations', () => ({
  collectVisitResultPhotoUrlsForUser_IO,
}));

const { cleanupNewsletterSubscriberByEmail } = vi.hoisted(() => ({
  cleanupNewsletterSubscriberByEmail: vi.fn(async (_arg: unknown) => undefined),
}));
vi.mock('@domain/user/operations/user-mutations.operations', () => ({
  cleanupNewsletterSubscriberByEmail,
}));

import { adminDeleteUserAny_IO } from './admin-user-management.operations';

const ADMIN_ID = 'usr_admin_000000000000001';
const TARGET_ID = 'usr_target_00000000000001';

const adminCaller = makeStylistCurrentUser({
  user: { id: ADMIN_ID, role_id: SystemRoleId.MASTER_ADMIN },
});

type RawTargetRow = Record<string, unknown>;

/** Raw DB row for user.findUnique(include) — fixture-typed, relations attached. */
const makeTargetRaw = (
  userOv: Partial<User> = {},
  acctOv: Partial<StylistAccount> | null = {}
): RawTargetRow => {
  const user = makeUser({
    id: TARGET_ID,
    email: 'target@test.local',
    ...userOv,
  });
  return {
    ...user,
    stylist_account:
      acctOv === null
        ? null
        : makeStylistAccount({ created_by_user_id: user.id, ...acctOv }),
    client_account: null,
    sessions: [],
    favorite_stylists: [],
    favorite_records: [],
  };
};

/**
 * user.findUnique dispatcher: `select` calls = the protection role-lookup,
 * `include`/plain calls = getUser_IO / snapshot reads (served from a queue;
 * the last row repeats).
 */
const makeUserFindUnique = ({
  roleRow,
  includeRows,
}: {
  roleRow: { role_id: string } | null;
  includeRows: (RawTargetRow | null)[];
}) => {
  const queue = [...includeRows];
  return vi.fn(async (args: { select?: Record<string, unknown> }) => {
    if (args.select) {
      return roleRow;
    }
    return queue.length > 1 ? (queue.shift() ?? null) : (queue[0] ?? null);
  });
};

const eventLogCreate = () =>
  vi.fn(async (args: { data: Record<string, unknown> }) => ({
    event_log_id: 'evl_test_1',
    created_at: new Date(),
    ...args.data,
  }));
describe('adminDeleteUserAny_IO', () => {
  it('unknown target → ADMIN_TARGET_NOT_FOUND, no Stripe cancel, no delete', async () => {
    const userDelete = vi.fn(async (_arg: unknown) => makeTargetRaw());
    mockDb({
      user: {
        findUnique: makeUserFindUnique({ roleRow: null, includeRows: [null] }),
        delete: userDelete,
      },
    });

    const result = await adminDeleteUserAny_IO({
      target_id: TARGET_ID,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_NOT_FOUND');
    }
    expect(cancelStripeSubscriptionIfExists).not.toHaveBeenCalled();
    expect(userDelete).not.toHaveBeenCalled();
  });

  it('happy path: Stripe cancel → self-protecting archive (is_gdpr_erased in SAME tx) → scoped hard-delete → GDPR cleanups → audit', async () => {
    const targetRaw = makeTargetRaw();
    collectVisitResultPhotoUrlsForUser_IO.mockResolvedValueOnce(['v1.jpg']);
    const galleryFindMany = vi.fn(async (_arg: unknown) => [
      { asset_url: 'g1.jpg' },
      { asset_url: 'g2.jpg' },
    ]);
    const deletedUserUpsert = vi.fn(async (_arg: unknown) => ({
      user_id: TARGET_ID,
    }));
    const backupDeleteMany = vi.fn(async (_arg: unknown) => ({ count: 0 }));
    const userDelete = vi.fn(async (_arg: unknown) => targetRaw);
    const auditCreate = eventLogCreate();
    mockDb({
      user: {
        findUnique: makeUserFindUnique({
          roleRow: { role_id: SystemRoleId.STYLIST_ROLE },
          includeRows: [targetRaw],
        }),
        delete: userDelete,
      },
      galleryRecord: { findMany: galleryFindMany },
      deletedUser: { upsert: deletedUserUpsert },
      impersonationBackup: {
        deleteMany: backupDeleteMany,
        findUnique: vi.fn(async (_arg: unknown) => null),
      },
      eventLog: { create: auditCreate },
    });

    const result = await adminDeleteUserAny_IO({
      target_id: TARGET_ID,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);

    // Live Stripe subscription canceled BEFORE the row disappears.
    expect(cancelStripeSubscriptionIfExists).toHaveBeenCalledWith(TARGET_ID);

    // Cloudinary collection is bounded + scoped to the target's account.
    const galleryArgs = galleryFindMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
      take: number;
    };
    expect(galleryArgs.where).toEqual({
      created_by_account: { created_by_user_id: TARGET_ID },
    });
    expect(galleryArgs.take).toBe(5000);

    // Terminal archive: full body + is_gdpr_erased=true on BOTH upsert branches
    // (non-restorable immediately — admin takedown is not silently reversible).
    const upsertArgs = deletedUserUpsert.mock.calls[0]?.[0] as unknown as {
      where: { user_id: string };
      update: { is_gdpr_erased: boolean; body: unknown };
      create: { user_id: string; is_gdpr_erased: boolean; body: unknown };
    };
    expect(upsertArgs.where).toEqual({ user_id: TARGET_ID });
    expect(upsertArgs.update.is_gdpr_erased).toBe(true);
    expect(upsertArgs.create.is_gdpr_erased).toBe(true);
    expect(upsertArgs.create.user_id).toBe(TARGET_ID);

    // Target-side impersonation backups vanish with the user row.
    expect(backupDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { impersonated_user_id: TARGET_ID } })
    );

    // Hard delete scoped by id.
    const deleteArgs = userDelete.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
    };
    expect(deleteArgs.where).toEqual({ id: TARGET_ID });

    // GDPR cascade of the email-keyed newsletter subscriber (no FK — explicit).
    expect(cleanupNewsletterSubscriberByEmail).toHaveBeenCalledWith(
      'target@test.local',
      'adminDeleteUserAny_IO',
      TARGET_ID
    );

    // Cloudinary cleanup gets gallery + visit-photo assets.
    expect(cleanupCloudinaryAssets).toHaveBeenCalledWith([
      'g1.jpg',
      'g2.jpg',
      'v1.jpg',
    ]);

    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditArgs = auditCreate.mock.calls[0]?.[0] as unknown as {
      data: { event: string };
    };
    expect(auditArgs.data.event).toBe(APP_EVENTS.INFO.USER.USER_DELETED);
  });

  it('no assets anywhere → Cloudinary cleanup is NOT invoked', async () => {
    const targetRaw = makeTargetRaw();
    mockDb({
      user: {
        findUnique: makeUserFindUnique({
          roleRow: { role_id: SystemRoleId.STYLIST_ROLE },
          includeRows: [targetRaw],
        }),
        delete: vi.fn(async (_arg: unknown) => targetRaw),
      },
      galleryRecord: { findMany: vi.fn(async (_arg: unknown) => []) },
      deletedUser: {
        upsert: vi.fn(async (_arg: unknown) => ({ user_id: TARGET_ID })),
      },
      impersonationBackup: {
        deleteMany: vi.fn(async (_arg: unknown) => ({ count: 0 })),
        findUnique: vi.fn(async (_arg: unknown) => null),
      },
      eventLog: { create: eventLogCreate() },
    });

    const result = await adminDeleteUserAny_IO({
      target_id: TARGET_ID,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    expect(cleanupCloudinaryAssets).not.toHaveBeenCalled();
  });
});
