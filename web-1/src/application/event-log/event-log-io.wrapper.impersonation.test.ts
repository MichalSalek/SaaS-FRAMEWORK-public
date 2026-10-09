/**
 * recordAuditEvent_IO names the impersonating admin (testy-api s34).
 *
 * Inside an impersonated session every audit row used to read as the user's own
 * act (name change, marketing consent, ...). The request frame now carries a lazy
 * resolver; the row keeps the user as subject and adds impersonated_by_admin_id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

const { writeRawEventLogMock } = vi.hoisted(() => ({
  writeRawEventLogMock: vi.fn(async (_args: unknown) => undefined),
}));

vi.mock('./event-log.client', () => ({
  writeRawEventLog_IO: writeRawEventLogMock,
}));
vi.mock('@domain/user/user.utils.api', () => ({
  fillUserMetadataWithLocation: async () => ({}),
}));

import { recordAuditEvent_IO } from './event-log-io.wrapper';
import {
  runWithRequestContext,
  setCurrentRequestImpersonationResolver,
} from '@app/http/request-context';

const USER_ID = 'usr_target_1';
const ADMIN_ID = 'usr_admin_1';

const inRequest = <T>(fn: () => Promise<T>) =>
  runWithRequestContext(
    {
      correlationId: 'c1',
      startedAtMs: 0,
      requestTarget: 'POST /api/v1/user/change-name',
      referer: null,
      userId: USER_ID,
    },
    fn
  );

const writtenMeta = () =>
  (
    writeRawEventLogMock.mock.calls[0]?.[0] as {
      meta: { created_by_user_id?: string; impersonated_by_admin_id?: string };
    }
  ).meta;

describe('recordAuditEvent_IO — impersonation stamp', () => {
  beforeEach(() => writeRawEventLogMock.mockClear());

  it('stamps the admin on a row written from an impersonated session', async () => {
    const resolver = vi.fn(async () => ADMIN_ID);
    await inRequest(async () => {
      setCurrentRequestImpersonationResolver(resolver);
      await recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.USER_NAME_CHANGED,
        user: { id: USER_ID },
      });
      await recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.USER_NAME_CHANGED,
        user: { id: USER_ID },
      });
    });
    expect(writtenMeta()).toMatchObject({
      created_by_user_id: USER_ID,
      impersonated_by_admin_id: ADMIN_ID,
    });
    // Memoised per request: one lookup for any number of rows.
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("leaves the user's own session unstamped", async () => {
    await inRequest(async () => {
      setCurrentRequestImpersonationResolver(async () => null);
      await recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.USER_NAME_CHANGED,
        user: { id: USER_ID },
      });
    });
    expect(writtenMeta().impersonated_by_admin_id).toBeUndefined();
  });

  it('writes normally outside any request frame (sweeps, startup)', async () => {
    await recordAuditEvent_IO({
      eventName: APP_EVENTS.INFO.USER.USER_NAME_CHANGED,
      user: { id: USER_ID },
    });
    expect(writtenMeta().impersonated_by_admin_id).toBeUndefined();
  });

  it('a failed lookup still writes every audit row (unstamped), memo holds null', async () => {
    const resolver = vi.fn(async () => {
      throw new Error('db down');
    });
    await inRequest(async () => {
      setCurrentRequestImpersonationResolver(resolver);
      await recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.USER_NAME_CHANGED,
        user: { id: USER_ID },
      });
      await recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.USER_NAME_CHANGED,
        user: { id: USER_ID },
      });
    });
    expect(writeRawEventLogMock).toHaveBeenCalledTimes(2);
    expect(writtenMeta().impersonated_by_admin_id).toBeUndefined();
  });
});
