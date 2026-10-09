/**
 * Pure-policy unit test — IS_EXISTS_REDIRECTION_FOR_PASSED_EVENT (routing.policy.ts).
 *
 * WHAT THIS PROTECTS
 * ──────────────────
 * Predykat odpowiada na pytanie „czy dla tego zdarzenia mamy przygotowane
 * przekierowanie". Pisany przez `in` badał CAŁY łańcuch prototypów, więc odpowiadał
 * twierdząco na `constructor`, `toString` i resztę `Object.prototype` — a wtedy
 * odczyt mapy oddaje FUNKCJĘ zamiast trasy. Dokładnie ta klasa wywróciła już
 * `getPlanConfig` (S120), gdzie `'constructor'` produkował „plan" z każdym limitem
 * `undefined` zamiast fallbacku do FREE.
 *
 * Dziś `event` przychodzi z naszego backendu, nie z inputu użytkownika, więc ścieżka
 * jest nieosiągalna — ale to własność WYWOŁUJĄCEGO, nie tego predykatu, i zmiana
 * po stronie wywołującego nie ma jak o tym przypomnieć. Ten test przypina zachowanie
 * do predykatu.
 *
 * METHOD: pure — importuje wyłącznie `@kernel/policies/routing.policy`.
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
