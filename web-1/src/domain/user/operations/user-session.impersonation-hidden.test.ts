/**
 * A live impersonation session (token = ImpersonationBackup.impersonated_session_token,
 * backup not expired) is invisible to the account owner: SESSION_GET_ALL does not list
 * it and SESSION_DELETE_EXACTLY resolves it like an unknown id. The caller's OWN
 * session (the admin operating through the impersonated session) is never hidden.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';

// setup.ts replaces this module with inert stubs for handler tests; this file
// exercises the real implementation.
vi.unmock('@domain/user/operations/user-session.operations');
vi.mock('@app/auth/better-auth/better-auth.config', () => ({ auth: {} }));

import {
  deleteSession_IO,
  getAllSessionsOfUser_IO,
} from './user-session.operations';

const USER_ID = 'usr_target_00000000000001';
const IMPERSONATED_TOKEN = 'tok_impersonated';
const OWN_TOKEN = 'tok_owner_phone';

type Where = {
  id?: string;
  userId?: string;
  token?: { notIn: string[] };
};

const SESSIONS = [
  { id: 'sess_owner', userId: USER_ID, token: OWN_TOKEN },
  { id: 'sess_imp', userId: USER_ID, token: IMPERSONATED_TOKEN },
];

const applyWhere = (where: Where) =>
  SESSIONS.filter(
    row =>
      (where.id === undefined || row.id === where.id) &&
      (where.userId === undefined || row.userId === where.userId) &&
      !(where.token?.notIn ?? []).includes(row.token)
  );

const setup = () => {
  const backupFindMany = vi.fn(async () => [
    { impersonated_session_token: IMPERSONATED_TOKEN },
  ]);
  const deleteMany = vi.fn(async (arg: { where: Where }) => ({
    count: applyWhere(arg.where).length,
  }));
  mockDb({
    impersonationBackup: { findMany: backupFindMany },
    session: {
      findMany: async (arg: { where: Where }) => applyWhere(arg.where),
      findFirst: async (arg: { where: Where }) =>
        applyWhere(arg.where)[0] ?? null,
      deleteMany,
    },
  });
  return { backupFindMany, deleteMany };
};

describe('impersonation session hidden from the account owner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SESSION_GET_ALL: the owner does not see the impersonation session', async () => {
    const { backupFindMany } = setup();

    const { sessions } = await getAllSessionsOfUser_IO({
      id: USER_ID,
      viewerSessionToken: OWN_TOKEN,
    });

    expect(sessions.map(session => session.id)).toEqual(['sess_owner']);
    const [backupArgs] = backupFindMany.mock.calls[0] as unknown as [
      { where: { impersonated_user_id: string; expires_at: { gt: Date } } },
    ];
    expect(backupArgs.where.impersonated_user_id).toBe(USER_ID);
    expect(backupArgs.where.expires_at.gt).toBeInstanceOf(Date);
  });

  it('SESSION_GET_ALL: the admin on the impersonation session still sees it', async () => {
    setup();

    const { sessions } = await getAllSessionsOfUser_IO({
      id: USER_ID,
      viewerSessionToken: IMPERSONATED_TOKEN,
    });

    expect(sessions.map(session => session.id).sort()).toEqual(
      ['sess_imp', 'sess_owner'].sort()
    );
  });

  it('SESSION_DELETE_EXACTLY: the impersonation session resolves like an unknown id', async () => {
    const { deleteMany } = setup();

    const result = await deleteSession_IO({
      id: USER_ID,
      session_id: 'sess_imp',
      viewerSessionToken: OWN_TOKEN,
    });

    expect(result).toEqual({ success: true, data: null });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("SESSION_DELETE_EXACTLY: the owner's other sessions stay deletable", async () => {
    setup();

    const result = await deleteSession_IO({
      id: USER_ID,
      session_id: 'sess_owner',
      viewerSessionToken: IMPERSONATED_TOKEN,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.id).toBe('sess_owner');
    }
  });
});
