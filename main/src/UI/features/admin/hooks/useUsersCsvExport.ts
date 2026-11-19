// UI/features/admin/hooks/useUsersCsvExport.ts
// „Eksportuj CSV” on the users list: reads every page of the current filters
// and sort, then downloads the chosen columns. The download is the success
// (no toast); a failed read stays on the page as an inline error.

import { useEffect, useRef, useState } from 'react';
import { adminGetUsersPaginated_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';
import { downloadCSV } from '../admin-csv';
import {
  USERS_CSV_FILE_BASE,
  buildUsersCsvTable,
  fetchAllAdminUsers,
} from '../users-csv';
import type { AdminUsersRequest } from './useAdminUsers';
import type { UsersTableColumn } from '../components/UsersTable.columns.config';

export interface UsersCsvExportState {
  isRunning: boolean;
  isError: boolean;
  /** The last file stopped at the row cap. */
  isCapped: boolean;
  run: () => void;
}

export function useUsersCsvExport(
  request: AdminUsersRequest,
  columns: readonly UsersTableColumn[],
  visibleIds: ReadonlySet<string>
): UsersCsvExportState {
  const [isRunning, setIsRunning] = useState(false);
  const [isError, setIsError] = useState(false);
  const [isCapped, setIsCapped] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  // Leaving the page stops the reads; nothing is downloaded afterwards.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = () => {
    if (controllerRef.current !== null) {
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsRunning(true);
    setIsError(false);
    setIsCapped(false);
    // The signal also keeps these reads silent (no global toast): the page
    // shows the failure itself.
    fetchAllAdminUsers(request, page =>
      adminGetUsersPaginated_IO(page, { signal: controller.signal })
    )
      .then(({ records, capped }) => {
        if (controller.signal.aborted) {
          return;
        }
        const { header, rows } = buildUsersCsvTable(
          columns,
          visibleIds,
          records
        );
        downloadCSV(USERS_CSV_FILE_BASE, header, rows);
        setIsCapped(capped);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setIsError(true);
        }
      })
      .finally(() => {
        controllerRef.current = null;
        if (!controller.signal.aborted) {
          setIsRunning(false);
        }
      });
  };

  return { isRunning, isError, isCapped, run };
}
