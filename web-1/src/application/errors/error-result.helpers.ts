import { failure } from '@kernel/application/result.types';
import type {
  DatabaseError,
  ExternalServiceError,
} from '@kernel/application/common-errors.types';
import type { OperationResult } from '@kernel/application/result.types';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { classifyQueryFailure } from '@app/db/prisma-error';

export function databaseFailure(
  operation: string,
  error: unknown
): OperationResult<never, DatabaseError> {
  // Request-attributable failures (unique race, dangling FK, unstorable value) are NOT a
  // server fault: they map to 409/400 in the error-mapper instead of an opaque 500
  // (DECISION at classifyQueryFailure). Still reported, at `warn`: each one means a call
  // site lacks its own domain mapping, which is worth seeing without paging as an outage.
  const reason = classifyQueryFailure(error);
  reportIssueBackend({
    namespace: 'DATABASE_ERROR',
    message: `${operation}: ${error instanceof Error ? error.message : String(error)}`,
    payload:
      error instanceof Error
        ? { message: error.message, stack: error.stack, reason }
        : { error: String(error), reason },
    mode: reason === null ? 'error' : 'warn',
  });
  return failure(
    reason === null
      ? { type: 'DATABASE_ERROR', operation }
      : { type: 'DATABASE_ERROR', operation, reason }
  );
}

export function externalServiceFailure(
  service: ExternalServiceError['service'],
  operation: string,
  error: unknown
): OperationResult<never, ExternalServiceError> {
  reportIssueBackend({
    namespace: 'EXTERNAL_SERVICE_ERROR',
    message: `${service}/${operation}: ${error instanceof Error ? error.message : String(error)}`,
    payload:
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { error: String(error) },
    mode: 'error',
  });
  return failure({ type: 'EXTERNAL_SERVICE_ERROR', service, operation });
}
