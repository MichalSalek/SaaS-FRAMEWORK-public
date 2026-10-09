/**
 * enforceImpersonationGate_IO — server truth first (testy-api s34).
 *
 * The gate used to decide "impersonating?" from the `become-user` header alone,
 * which the impersonating admin controls: dropping it turned every gated mutation
 * into a plain user mutation. These pin that the SESSION TOKEN recorded by
 * become-user gates the request whatever headers it carries.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest } from 'next';

import { mockDb } from '../../test-utils/mockApiHandler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

const { writeRawEventLogMock, verifyBackupMock } = vi.hoisted(() => ({
  writeRawEventLogMock: vi.fn(async (_args: unknown) => undefined),
  verifyBackupMock: vi.fn(async (_header: string) => null),
}));

vi.mock('@app/event-log/event-log.client', () => ({
  writeRawEventLog_IO: writeRawEventLogMock,
}));
vi.mock('@domain/admin/impersonation-backup.utils', () => ({
  verifyImpersonationBackup: verifyBackupMock,
}));

import { enforceImpersonationGate_IO } from './admin-impersonation.utils';

const ADMIN_ID = 'admin_1';
const TARGET_ID = 'target_1';
const IMPERSONATED_TOKEN = 'tok_impersonated';

type BackupRow = {
  admin_user_id: string;
  impersonated_user_id: string;
  impersonated_session_token: string;
};

const installBackups = (rows: BackupRow[]) => {
  mockDb({
    impersonationBackup: {
      findFirst: async (args: {
        where: {
          impersonated_session_token: string;
          impersonated_user_id: string;
        };
      }) =>
        rows.find(
          row =>
            row.impersonated_session_token ===
              args.where.impersonated_session_token &&
            row.impersonated_user_id === args.where.impersonated_user_id
        ) ?? null,
    },
  });
};

const request = (query: Record<string, string> = {}): NextApiRequest =>
  ({
    headers: {},
    query,
    url: '/api/v1/user/disable/self',
    method: 'POST',
  }) as never;

const gate = (sessionToken: string, currentUserId = TARGET_ID, query = {}) =>
  enforceImpersonationGate_IO({
    req: request(query),
    command: APP_EVENTS.COMMANDS.USER.USER_DISABLE_SELF,
    currentUserId,
    sessionToken,
  });

describe('enforceImpersonationGate_IO — session token is the source of truth', () => {
  beforeEach(() => {
    writeRawEventLogMock.mockClear();
    verifyBackupMock.mockClear();
    installBackups([
      {
        admin_user_id: ADMIN_ID,
        impersonated_user_id: TARGET_ID,
        impersonated_session_token: IMPERSONATED_TOKEN,
      },
    ]);
  });

  it('blocks a sensitive command from the impersonated session WITHOUT the become-user header', async () => {
    const result = await gate(IMPERSONATED_TOKEN);
    expect(result.success).toBe(false);
    const row = writeRawEventLogMock.mock.calls[0]?.[0] as {
      eventName: string;
      meta: { created_by_user_id: string };
    };
    expect(row.eventName).toBe(
      APP_EVENTS.INFO.ADMIN.IMPERSONATION_SENSITIVE_BLOCKED
    );
    expect(row.meta.created_by_user_id).toBe(ADMIN_ID);
  });

  it('lets the admin override explicitly, with the override audit row', async () => {
    const result = await gate(IMPERSONATED_TOKEN, TARGET_ID, {
      override_impersonation_block: 'true',
    });
    expect(result).toEqual({ success: true, data: { wasOverride: true } });
    const row = writeRawEventLogMock.mock.calls[0]?.[0] as {
      eventName: string;
    };
    expect(row.eventName).toBe(
      APP_EVENTS.INFO.ADMIN.IMPERSONATION_SENSITIVE_OVERRIDE
    );
  });

  it("passes the user's own session (no backup for that token)", async () => {
    const result = await gate('tok_own_login');
    expect(result).toEqual({ success: true, data: { wasOverride: false } });
    expect(writeRawEventLogMock).not.toHaveBeenCalled();
  });

  it('does not match a backup bound to a different user', async () => {
    const result = await gate(IMPERSONATED_TOKEN, 'someone_else');
    expect(result.success).toBe(true);
  });
});
