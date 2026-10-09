import { reportIssueBackend } from '@app/debugger/error-handler';
import { failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';

/**
 * Support-specific DB-error breadcrumb + DATABASE_ERROR failure.
 *
 * Split z support-admin.operations.ts dla utrzymania ESLint max-lines (350); mirror
 * konwencji support-thread-lock.helper.ts / support-status-write.helper.ts (op-helpery
 * obok operacji). Zachowuje 1:1 zachowanie poprzednich inline catch-blokow: celowo NIE
 * uzywa generic databaseFailure() — trzyma support-namespace (np. SUPPORT_ADMIN_REPLY_ERROR)
 * i kontekst (threadId/status) w payloadzie zamiast generycznego DATABASE_ERROR+stack,
 * zeby latwiej namierzyc konkretny watek w logach.
 */
export const supportDbFailure = (
  error: unknown,
  meta: {
    namespace: string;
    prefix: string;
    operation: string;
    payload: Record<string, unknown>;
  }
): OperationResult<never, DatabaseError> => {
  reportIssueBackend({
    namespace: meta.namespace,
    message: `${meta.prefix}: ${error instanceof Error ? error.message : String(error)}`,
    payload: { ...meta.payload, error },
    mode: 'error',
  });
  return failure({ type: 'DATABASE_ERROR', operation: meta.operation });
};
