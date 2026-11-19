import type { ApiContract } from './contract.types';

/**
 * Checks a sent response against its contract: a 2xx envelope must carry one of the declared
 * success events and a `data` that parses with the response schema. Returns the violation, or
 * `null`. Errors (non-2xx) are the error mapper's contract and are not checked here.
 *
 * DECISION: `data` is checked in its WIRE form (a JSON round trip), because that is what the client
 * receives: a `Date` the handler forgot to serialise arrives as a string, and an `undefined` key
 * disappears. Used by web-1 `defineEndpoint` in tests and development; production does not pay for it.
 */
export const findContractResponseViolation = (
  contract: Pick<ApiContract, 'key' | 'response' | 'successEvents'>,
  status: number,
  envelope: unknown
): string | null => {
  if (status < 200 || status >= 300) {
    return null;
  }
  if (typeof envelope !== 'object' || envelope === null) {
    return `${contract.key}: a ${status} response has no { event, data } envelope`;
  }
  const event = 'event' in envelope ? envelope.event : undefined;
  if (
    typeof event !== 'string' ||
    !contract.successEvents.some(allowed => allowed === event)
  ) {
    return `${contract.key}: ${status} carries event "${String(event)}", the contract allows ${contract.successEvents.join(', ')}`;
  }
  const data = 'data' in envelope ? envelope.data : undefined;
  const wire: unknown =
    data === undefined ? undefined : JSON.parse(JSON.stringify(data));
  const parsed = contract.response.safeParse(wire);
  if (parsed.success) {
    return null;
  }
  const issues = parsed.error.issues
    .slice(0, 5)
    .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return `${contract.key}: response data does not match the contract (${issues})`;
};
