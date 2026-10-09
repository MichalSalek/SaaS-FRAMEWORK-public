/**
 * Shared scenario scaffolding for resolveContentReport_IO unit suites
 * (split across moderation-admin.operations.test.ts and
 * moderation-admin.resolve-actions.test.ts to satisfy max-lines).
 * Full contract docs: header of moderation-admin.operations.test.ts.
 */
import { vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { resolveContentReport_IO } from './moderation-admin.operations';
import { ModerationAction } from '@kernel/models/moderation/moderation.dto';
import { ContentReportStatusValue } from '@kernel/models/db_models.generated.dto';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

export const REPORT_ID = 'rep_test_0000000000001';
export const RECORD_ID = 'gr_test_00000000000001';
export const ACCOUNT_ID = 'acc_test_0000000000001';
export const OWNER_USER_ID = 'usr_test_owner_000001';
export const OWNER_EMAIL = 'owner@test.local';
export const ADMIN_ID = 'usr_test_admin_000001';

export type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: (...args: never[]) => unknown): RawStub =>
  fn as unknown as RawStub;

export type ReportRow = {
  id: string;
  gallery_record_id: string | null;
  status: string;
  gallery_record: {
    gallery_record_id: string;
    asset_url: string;
    is_hidden: boolean;
    created_by_account_id: string;
    created_by_account: {
      account_id: string;
      created_by_user_id: string;
      created_by_user: { email: string; role_id: string };
    } | null;
  } | null;
};

export const makeReportRow = (over: Partial<ReportRow> = {}): ReportRow => ({
  id: REPORT_ID,
  gallery_record_id: RECORD_ID,
  status: ContentReportStatusValue.PENDING,
  gallery_record: {
    gallery_record_id: RECORD_ID,
    asset_url: 'https://cdn.test/nails.jpg',
    is_hidden: false,
    created_by_account_id: ACCOUNT_ID,
    created_by_account: {
      account_id: ACCOUNT_ID,
      created_by_user_id: OWNER_USER_ID,
      created_by_user: {
        email: OWNER_EMAIL,
        role_id: SystemRoleId.STYLIST_ROLE,
      },
    },
  },
  ...over,
});

export type RawCall = { sql: string; values: unknown[] };

export type ResolveScenario = {
  report?: ReportRow | null;
  /** Status seen by the post-lock re-read (select { status }); null = row vanished in the lock window. */
  lockedStatus?: string | null;
  /** favoriteGalleryRecord.count result (likes of the affected record(s)). */
  likesCount?: number;
  /** galleryRecord.updateMany count (HIDE flip / BAN bulk-hide). */
  galleryUpdateManyCount?: number;
  /** galleryRecord.deleteMany count (DELETE branch). */
  deletedCount?: number;
  /** user.updateMany count (BAN idempotent flip). */
  bannedCount?: number;
};

export const mockResolveScenario = ({
  report = makeReportRow(),
  lockedStatus = ContentReportStatusValue.PENDING,
  likesCount = 0,
  galleryUpdateManyCount = 1,
  deletedCount = 1,
  bannedCount = 1,
}: ResolveScenario = {}) => {
  const reportFindUnique = vi.fn(
    async (arg: { select?: { status?: boolean } }) =>
      arg.select?.status === true
        ? lockedStatus === null
          ? null
          : { status: lockedStatus }
        : report
  );
  const reportUpdate = vi.fn(async (_arg: unknown) => ({ id: REPORT_ID }));
  const reportUpdateMany = vi.fn(async (_arg: unknown) => ({ count: 0 }));
  const favCount = vi.fn(async (_arg: unknown) => likesCount);
  const galleryUpdateMany = vi.fn(async (_arg: unknown) => ({
    count: galleryUpdateManyCount,
  }));
  const galleryDeleteMany = vi.fn(async (_arg: unknown) => ({
    count: deletedCount,
  }));
  const saUpdateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
  const userUpdateMany = vi.fn(async (_arg: unknown) => ({
    count: bannedCount,
  }));
  const sessionDeleteMany = vi.fn(async (_arg: unknown) => ({ count: 2 }));

  // Raw-SQL spy: decrement helpers call tx.$executeRaw`UPDATE ... ${by}::int ... ${accountId}`
  // — capture joined SQL + bind values so tests can assert column + amount + target.
  const rawCalls: RawCall[] = [];
  const executeRaw = async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number> => {
    rawCalls.push({ sql: strings.join(' ? '), values });
    return 1;
  };

  mockDb({
    contentReport: {
      findUnique: reportFindUnique,
      update: reportUpdate,
      updateMany: reportUpdateMany,
    },
    favoriteGalleryRecord: { count: favCount },
    galleryRecord: {
      updateMany: galleryUpdateMany,
      deleteMany: galleryDeleteMany,
    },
    stylistAccount: { updateMany: saUpdateMany },
    user: { updateMany: userUpdateMany },
    session: { deleteMany: sessionDeleteMany },
    $queryRaw: rawStub(async () => [
      { id: OWNER_USER_ID, account_id: ACCOUNT_ID },
    ]),
    $executeRaw: rawStub(executeRaw),
  });

  const galleryDecrements = () =>
    rawCalls.filter(c => c.sql.includes('cached_gallery_count'));
  const likeDecrements = () =>
    rawCalls.filter(c => c.sql.includes('cached_likes_count'));

  return {
    reportFindUnique,
    reportUpdate,
    reportUpdateMany,
    favCount,
    galleryUpdateMany,
    galleryDeleteMany,
    saUpdateMany,
    userUpdateMany,
    sessionDeleteMany,
    rawCalls,
    galleryDecrements,
    likeDecrements,
  };
};

/**
 * Admin caller for the resolve op's operation-boundary requireAdminPermission
 * guard. Pass an id to model an admin who also owns the reported record (used by
 * the ADMIN_CANNOT_TARGET_SELF path).
 */
export const adminCurrentUser = (id: string = ADMIN_ID) =>
  makeStylistCurrentUser({
    user: { id, role_id: SystemRoleId.MASTER_ADMIN },
  });

/** Non-admin caller — exercises the operation-boundary requireAdminPermission reject. */
export const nonAdminCurrentUser = () => makeStylistCurrentUser();

export const callResolve = (
  overrides: Partial<Parameters<typeof resolveContentReport_IO>[0]> = {}
) =>
  resolveContentReport_IO({
    report_id: REPORT_ID,
    action: ModerationAction.HIDE,
    admin_note: undefined,
    currentUser: adminCurrentUser(),
    ...overrides,
  });
