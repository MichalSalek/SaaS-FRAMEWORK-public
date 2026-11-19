import { describe, expect, it, vi } from 'vitest';
import handler from '../../pages/api/v1/email/lifecycle-actions/index';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser, __setPermission, __setDb } from '../setup';
import { makeClientCurrentUser, makeCurrentUserOutput } from '../fixtures';
import type { EMAIL_DTO_API_V1 } from '@kernel/models/email/email.dto';

describe('GET lifecycle-actions ownership across UI roles', () => {
  it('uses the authenticated dual-role owner id while CLIENT is active and ignores a query recipient', async () => {
    const user = makeClientCurrentUser({
      user: { id: 'stylist-currently-client' },
    });
    __setCurrentUser(makeCurrentUserOutput(user));
    __setPermission(null);
    const query = vi.fn(async (_sql: { values: unknown[] }) => []);
    __setDb({ $queryRaw: query });
    const result = await mockApiHandler<
      EMAIL_DTO_API_V1['EMAIL_LIFECYCLE_ACTIONS']['RESPONSE']
    >(handler, {
      method: 'GET',
      query: { userId: 'foreign-user' },
      url: '/api/v1/email/lifecycle-actions',
    });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ actions: [], nextCursor: null });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0].values).toContain(user.id);
    expect(query.mock.calls[0]?.[0].values).not.toContain('foreign-user');
  });
});
