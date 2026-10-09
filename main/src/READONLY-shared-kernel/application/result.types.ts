// OperationResult<T, E> — Discriminated union for typed operation results
// SSOT: All domain operations return this type instead of throw/string patterns

export type OperationResult<T, E = never> =
  { success: true; data: T } | { success: false; error: E };

export function success<T>(data: T): OperationResult<T, never> {
  return { success: true, data };
}

export function failure<E>(error: E): OperationResult<never, E> {
  return { success: false, error };
}
