import { describe, it, expect } from 'vitest';
import { findContractResponseViolation } from '@kernel/application/contracts/contract-response';
import { FAVORITE_CONTRACTS } from '@kernel/domain/favorites/favorite.contracts';
import { API_CONTRACT_LIST } from '@kernel/application/contracts/api-contracts.registry';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { API_HTTP_METHODS } from '@kernel/domain/http/http-methods.config';
import type { ContractSpec } from '@kernel/application/contracts/contract.types';

// Compile-time witness (a wrong boolean is a tsc error): the ContractSpec union forbids the
// combinations CQRS does not allow; the generator repeats the check at runtime.
type Cmd = typeof FAVORITE_CONTRACTS.FAVORITE_ADD_RECORD;
type Qry = typeof FAVORITE_CONTRACTS.FAVORITE_GET_RECORDS;
type Legal<T> = [T] extends [ContractSpec] ? true : false;
const specWitness: {
  command: Legal<Cmd>;
  query: Legal<Qry>;
  commandOverGet: Legal<Omit<Cmd, 'method'> & { method: 'GET' }>;
  commandWithoutBody: Legal<Omit<Cmd, 'body'> & { body: null }>;
  commandWithQuery: Legal<Omit<Cmd, 'query'> & { query: Qry['query'] }>;
  queryOverPost: Legal<Omit<Qry, 'method'> & { method: 'POST' }>;
  queryWithBody: Legal<Omit<Qry, 'body'> & { body: Cmd['body'] }>;
} = {
  command: true,
  query: true,
  commandOverGet: false,
  commandWithoutBody: false,
  commandWithQuery: false,
  queryOverPost: false,
  queryWithBody: false,
};

const C = FAVORITE_CONTRACTS.FAVORITE_REMOVE_RECORD;

describe('ContractSpec', () => {
  it('keeps the compile-time witness of legal kind/method/body/query combinations', () => {
    expect(specWitness.command && specWitness.query).toBe(true);
  });
});

describe('findContractResponseViolation', () => {
  it('accepts a declared success event with a matching payload', () => {
    expect(
      findContractResponseViolation(C, 200, {
        event: 'RECORD_NOT_IN_FAVORITES',
        data: { success: true },
      })
    ).toBeNull();
  });

  it('rejects an undeclared success event', () => {
    expect(
      findContractResponseViolation(C, 200, {
        event: 'SUCCESS',
        data: { success: true },
      })
    ).toContain('carries event "SUCCESS"');
  });

  it('rejects a payload that does not parse, checked in wire form', () => {
    expect(
      findContractResponseViolation(C, 200, {
        event: 'RECORD_REMOVED_FROM_FAVORITES',
        data: { success: 'yes' },
      })
    ).toContain('success');
    // A Date serialises to a string: the wire form is what is checked.
    expect(
      findContractResponseViolation(
        FAVORITE_CONTRACTS.FAVORITE_GET_GROUPED,
        200,
        {
          event: 'FAVORITE_GROUPED_FETCHED',
          data: {
            groups: [
              {
                stylist_account_id: 's',
                stylist_display_name: null,
                stylist_profile_image_url: null,
                favorites_count: 1,
                recent_favorites: [
                  {
                    favorite_id: 'f',
                    gallery_record_id: 'g',
                    image_url: 'u',
                    created_at: new Date(0),
                  },
                ],
              },
            ],
          },
        }
      )
    ).toBeNull();
  });

  it('ignores error responses (the error mapper owns them)', () => {
    expect(findContractResponseViolation(C, 404, { event: 'X' })).toBeNull();
  });
});

describe('generated compatibility registries agree with the contracts', () => {
  it.each(API_CONTRACT_LIST.map(c => [c.key, c] as const))(
    '%s: ROUTES_API and API_HTTP_METHODS carry the contract route and method',
    (key, contract) => {
      expect(Object.entries(ROUTES_API)).toContainEqual([key, contract.route]);
      expect(Object.entries(API_HTTP_METHODS)).toContainEqual([
        key,
        contract.method,
      ]);
    }
  );
});
