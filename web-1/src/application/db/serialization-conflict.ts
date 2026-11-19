import { hasCode } from '@kernel/models/type_narrowing';

export function isSerializationConflict(error: unknown): boolean {
  // (a) Classic Prisma known-request error code (other adapters / future re-wrapping).
  if (hasCode(error) && error.code === 'P2034') {
    return true;
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, unknown>;

    // (b) Top-level error named directly after the conflict kind.
    if (candidate.name === 'TransactionWriteConflict') {
      return true;
    }

    // (c) DriverAdapterError wrapper: the kind lives in `.cause.kind` (adapter-pg 7.x shape).
    const cause = candidate.cause;
    if (
      typeof cause === 'object' &&
      cause !== null &&
      (cause as Record<string, unknown>).kind === 'TransactionWriteConflict'
    ) {
      return true;
    }
  }

  // (d) Last-resort string sniff over message + stack (adapter sets message to the kind,
  // and the raw SQLSTATE 40001 may appear in nested driver errors).
  if (error instanceof Error) {
    const haystack = `${error.message}\n${error.stack ?? ''}`;
    if (
      haystack.includes('TransactionWriteConflict') ||
      haystack.includes('40001')
    ) {
      return true;
    }
  }

  return false;
}
