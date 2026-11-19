import { useEffect } from 'react';

type PermissionMatrix = Record<string, Set<string>>;

/** Copies the server permission matrix into the local editable one, once, when it arrives. */
export function useInitialPermissionMatrix(
  isSuccess: boolean,
  serverMatrix: PermissionMatrix,
  localMatrix: PermissionMatrix,
  setLocalMatrix: (matrix: PermissionMatrix) => void
): void {
  // DECISION: run-once populate gated by the localMatrix-empty guard. Adding localMatrix to deps
  // would re-run on every edit (a guarded no-op); the run-once intent is the contract. This file
  // is the one place `react-hooks/exhaustive-deps` is off for it (main/eslint.config.mjs), and
  // 'use no memo' keeps the React Compiler from compiling around the omission.
  'use no memo';
  useEffect(() => {
    if (isSuccess && Object.keys(localMatrix).length === 0) {
      setLocalMatrix(serverMatrix);
    }
    // Only run when serverMatrix reference changes (i.e. query data arrives)
  }, [serverMatrix, isSuccess]);
}
