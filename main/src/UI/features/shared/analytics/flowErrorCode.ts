// UI/features/shared/analytics/flowErrorCode.ts
// The one way a `*_failed` flow step names its cause (property `code`): the
// API event name of a failed call, or a fallback when the failure never
// reached our API (network, thrown, a direct vendor upload). Never a message
// text, which can carry what the person typed.

import { isIOError } from '../../../../application/http/toPromise.adapter';

export function flowErrorCode(error: unknown, fallback = 'unknown'): string {
  return isIOError(error) ? String(error.httpError.event) : fallback;
}
