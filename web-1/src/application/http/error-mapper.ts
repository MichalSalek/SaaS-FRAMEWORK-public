// Central error-to-HTTP mapper: every DomainError reaches the client through the one composed map
// (`error-map/domain-error.map.ts`), which owns the per-domain responders and the compile-time
// coverage and uniqueness guarantees.
import type { NextApiResponse } from 'next';

import { reportIssueBackend } from '@app/debugger/error-handler';
import { respondGeneralError } from './http.responses.utils';
import { DOMAIN_ERROR_RESPONDERS } from './error-map/domain-error.map';
import type { DomainError, ErrorsByType } from './error-map/error-map.types';

export type { DomainError } from './error-map/error-map.types';

type DomainErrorType = DomainError['type'];

const hasResponder = (type: string): type is DomainErrorType =>
  Object.prototype.hasOwnProperty.call(DOMAIN_ERROR_RESPONDERS, type);

// Generic over the discriminant so `DOMAIN_ERROR_RESPONDERS[type]` and `error` stay correlated
// without a cast (TypeScript #47109).
const respondWith = <K extends DomainErrorType>(
  res: NextApiResponse,
  type: K,
  error: ErrorsByType<DomainError>[K]
): void => {
  DOMAIN_ERROR_RESPONDERS[type](res, error);
};

export function mapErrorToResponse(
  res: NextApiResponse,
  error: DomainError
): void {
  // Unreachable for a typed DomainError (the map covers the union at compile time); guards a value
  // that reached here through a cast or untyped data. DD-L2: report only the discriminant (no PII)
  // and answer with the opaque 500.
  if (!hasResponder(error.type)) {
    reportIssueBackend({
      namespace: 'ERROR_MAPPER_DEFAULT',
      message: 'Unmapped error type encountered',
      payload: { errorType: error.type },
      mode: 'error',
    });
    return respondGeneralError(res, undefined);
  }
  respondWith(res, error.type, error);
}
