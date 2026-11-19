/**
 * Pure-policy unit test for IS_EXISTS_REDIRECTION_FOR_PASSED_EVENT (routing.policy.ts).
 * The predicate answers "do we have a redirect prepared for this event". Written with `in`, it
 * checked the whole prototype chain and answered yes for `constructor`, `toString` and the
 * rest of `Object.prototype`, so the map read returned a FUNCTION instead of a route. The same
 * class broke `getPlanConfig`, where `'constructor'` produced a "plan" with every limit
 * `undefined` instead of falling back to FREE.
 * Today `event` comes from our backend, not user input, so the path is unreachable. That is a
 * property of the caller, not of this predicate, and a caller change cannot remind anyone, so
 * this test pins the behavior to the predicate.
 * Method: pure, imports only `@kernel/policies/routing.policy`.
 */
import { describe, expect, it } from 'vitest';

import { ROUTING_POLICY } from '@kernel/policies/routing.policy';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';

const check = (event: string): boolean =>
  ROUTING_POLICY.utils.IS_EXISTS_REDIRECTION_FOR_PASSED_EVENT({
    event: event as EVENT_INFO_TYPE,
  });

describe('IS_EXISTS_REDIRECTION_FOR_PASSED_EVENT — tylko własne klucze', () => {
  it.each([
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    '__proto__',
  ])(
    'nie uznaje odziedziczonego klucza %s za skonfigurowane przekierowanie',
    inherited => {
      expect(check(inherited)).toBe(false);
    }
  );

  it('zwraca false dla braku zdarzenia', () => {
    expect(
      ROUTING_POLICY.utils.IS_EXISTS_REDIRECTION_FOR_PASSED_EVENT({
        event: null,
      })
    ).toBe(false);
    expect(
      ROUTING_POLICY.utils.IS_EXISTS_REDIRECTION_FOR_PASSED_EVENT({})
    ).toBe(false);
  });

  it('zwraca false dla zdarzenia, ktorego nie ma w zadnej mapie', () => {
    expect(check('ZDARZENIE_KTOREGO_NIE_MA')).toBe(false);
  });
});
