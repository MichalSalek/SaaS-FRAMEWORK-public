// UI/features/admin/users-csv.ts
// The users list as one CSV file: every person matching the page's filters and
// sort (not only the page on screen), in the columns the admin chose, under
// the same headers as the table. Escaping and the download: admin-csv.ts.

import type { AdminUserRecord, AdminUsersRequest } from './hooks/useAdminUsers';
import type { UsersTableColumn } from './components/UsersTable.columns.config';

/** The backend's largest page (admin-user-search.operations.ts clamps `take`). */
export const USERS_CSV_PAGE_SIZE = 100;
/** Most rows one file carries; the page says so when the list is longer. */
export const USERS_CSV_ROW_CAP = 5000;
export const USERS_CSV_FILE_BASE = 'nailfolio-uzytkownicy';

type UsersPage = { records: AdminUserRecord[]; nextCursor: string | null };

export interface AllUsersResult {
  records: AdminUserRecord[];
  /** The list had more rows than the cap; the file holds the first `cap`. */
  capped: boolean;
}

/**
 * Reads every page of `request` (its filters and sort; its cursor and page
 * size are replaced) until the list ends or `cap` rows are collected.
 */
export async function fetchAllAdminUsers(
  request: AdminUsersRequest,
  fetchPage: (request: AdminUsersRequest) => Promise<UsersPage>,
  cap: number = USERS_CSV_ROW_CAP
): Promise<AllUsersResult> {
  const records: AdminUserRecord[] = [];
  const base: AdminUsersRequest = { ...request };
  delete base.cursor;
  let cursor: string | null = null;
  do {
    const page: UsersPage = await fetchPage({
      ...base,
      take: USERS_CSV_PAGE_SIZE,
      ...(cursor !== null && { cursor }),
    });
    records.push(...page.records);
    cursor = page.nextCursor;
    if (records.length >= cap) {
      return {
        records: records.slice(0, cap),
        capped: records.length > cap || cursor !== null,
      };
    }
  } while (cursor !== null);
  return { records, capped: false };
}

/** Header and plain-text rows for the chosen columns, in table order. */
export function buildUsersCsvTable(
  columns: readonly UsersTableColumn[],
  visibleIds: ReadonlySet<string>,
  users: readonly AdminUserRecord[]
): { header: string[]; rows: string[][] } {
  const chosen = columns.filter(column => visibleIds.has(column.id));
  return {
    header: chosen.map(column => column.header),
    rows: users.map(user =>
      chosen.map(column => {
        const value = column.csv(user);
        return value === null ? '' : String(value);
      })
    ),
  };
}
