// tests/concurrency/admin-users-sort-pagination.concurrency.ts
//
// FAMILY 8: admin users list: cursor pagination under the aggregate and nullable sort keys
// (`photos` = relation count, `last_login_at` and `city` = nulls last).
//
// RISK: the list pages with a cursor on `User.id` while ordering by another key with `id` as the
// tiebreaker. For an ORDER BY over a relation count or a nullable column Prisma rebuilds the
// cursor's position from those values, and a wrong rebuild skips or repeats people. The mock unit
// test only sees the orderBy we pass; this family walks the REAL endpoint.
//
// INVARIANT: for every key and direction, walking the list with pages of 25 and of 100 gives the
// same order, with no repeats. The dev database is shared with runs that create and delete people
// meanwhile, so a person missing from one walk counts as a skip only when the row existed for the
// whole test with a stable sort key (no sign-in or update since the start: a sign-in legitimately
// moves a person within `last_login_at` order).

import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { apiCall, getAdminToken, getData } from '../utils/api-client';
import type { ApiResponse } from '../utils/api-client';
import { dbQuery } from '../utils/db-client';
import { test, assertEqual, assertTrue } from './_harness';

type UsersPage = { records: { id: string }[]; nextCursor: string | null };

const MAX_PAGES = 200;

const walk = async (
  token: string,
  sortBy: string,
  order: 'asc' | 'desc',
  take: number
): Promise<string[]> => {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query: URLSearchParams = new URLSearchParams({
      take: String(take),
      sort_by: sortBy,
      sort_order: order,
      ...(cursor !== null ? { cursor } : {}),
    });
    const response: ApiResponse = await apiCall({
      endpoint: `${ROUTES_API.ADMIN_GET_USERS_PAGINATED}?${query.toString()}`,
      token,
    });
    assertEqual(response.status, 200, `${sortBy} ${order} page ${page}`);
    const data: UsersPage = getData<UsersPage>(response);
    ids.push(...data.records.map(record => record.id));
    if (data.nextCursor === null) {
      return ids;
    }
    cursor = data.nextCursor;
  }
  throw new Error(`${sortBy} ${order}: more than ${MAX_PAGES} pages`);
};

for (const sortBy of ['photos', 'last_login_at', 'city'] as const) {
  for (const order of ['desc', 'asc'] as const) {
    test(
      `admin users: cursor walk is stable under sort_by=${sortBy} ${order}`,
      async () => {
        const token = await getAdminToken();
        const startedAt = new Date();
        const small = await walk(token, sortBy, order, 25);
        const large = await walk(token, sortBy, order, 100);
        assertEqual(new Set(small).size, small.length, 'no repeat (25)');
        assertEqual(new Set(large).size, large.length, 'no repeat (100)');

        const inSmall = new Set(small);
        const inLarge = new Set(large);
        const missing = [
          ...small.filter(id => !inLarge.has(id)),
          ...large.filter(id => !inSmall.has(id)),
        ];
        if (missing.length > 0) {
          const stable = await dbQuery<{ id: string }>(
            `SELECT id FROM "users"
              WHERE id = ANY($1) AND created_at < $2 AND updated_at < $2
                AND (last_login_at IS NULL OR last_login_at < $2)`,
            [missing, startedAt]
          );
          assertEqual(
            stable.length,
            0,
            `people present all along but skipped by one walk: ${stable
              .map(row => row.id)
              .join(', ')}`
          );
        }

        const common = small.filter(id => inLarge.has(id));
        const commonLarge = large.filter(id => inSmall.has(id));
        assertTrue(
          common.every((id, index) => id === commonLarge[index]),
          'pages of 25 and of 100 give the same order'
        );
      },
      'admin-users-aggregate-sort-cursor'
    );
  }
}
