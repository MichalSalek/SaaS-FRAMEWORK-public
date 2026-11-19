// Client side of the single-contract pilot: the favorites IO functions are derived from the kernel
// contracts. Runtime: the URL, the method and the query string come from the contract. Compile time
// (the `witness` object below fails `tsc` when a property turns false): a wrong body, a wrong query
// value type, a wrong response type and a URL override are not representable.
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../../test-utils/msw/server';
import type { Equals } from '@kernel/policies/validation/validation.zod';
import type { ContractEndpointOptions } from '../../application/http/io';
import {
  addRecordToFavorites_IO,
  getFavoriteRecords_IO,
  getFavoriteGrouped_IO,
} from './favoriteIO.possibilities.api';

type AddRequest = Parameters<typeof addRecordToFavorites_IO>[0];
type AddResponse = Awaited<ReturnType<typeof addRecordToFavorites_IO>>;
type ListRequest = Parameters<typeof getFavoriteRecords_IO>[0];
type Assignable<A, B> = [A] extends [B] ? true : false;

const witness: {
  bodyOfAnotherEndpoint: Assignable<{ stylist_account_id: string }, AddRequest>;
  bodyWithWrongFieldType: Assignable<{ gallery_record_id: number }, AddRequest>;
  validBody: Assignable<{ gallery_record_id: string; note: null }, AddRequest>;
  responseNoteIsNullable: Equals<AddResponse['note'], string | null>;
  queryWithWrongValueType: Assignable<{ take: string }, ListRequest>;
  validQuery: Assignable<{ cursor: string; take: number }, ListRequest>;
  noUrlOverride: 'url' extends keyof ContractEndpointOptions ? true : false;
} = {
  bodyOfAnotherEndpoint: false,
  bodyWithWrongFieldType: false,
  validBody: true,
  responseNoteIsNullable: true,
  queryWithWrongValueType: false,
  validQuery: true,
  noUrlOverride: false,
};

describe('favorites IO derived from the kernel contracts', () => {
  it('keeps the compile-time witness (a false here is a type error first)', () => {
    expect(witness.validBody && witness.validQuery).toBe(true);
  });

  it('a command POSTs its body to the contract route', async () => {
    let seen: { method: string; url: string; body: unknown } | null = null;
    mswServer.use(
      http.all('*/api/v1/favorite/add-record', async ({ request }) => {
        seen = {
          method: request.method,
          url: request.url,
          body: await request.json(),
        };
        return HttpResponse.json(
          {
            event: 'FAVORITE_RECORD_ADDED',
            data: {
              id: 'f',
              client_user_id: 'c',
              gallery_record_id: 'g',
              note: null,
            },
          },
          { status: 201 }
        );
      })
    );
    const data = await addRecordToFavorites_IO({ gallery_record_id: 'g' });
    expect(data.gallery_record_id).toBe('g');
    expect(seen).toMatchObject({
      method: 'POST',
      body: { gallery_record_id: 'g' },
    });
  });

  it('a GET carries exactly the declared query fields', async () => {
    const urls: string[] = [];
    mswServer.use(
      http.get('*/api/v1/favorite/get-records', ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({
          event: 'FAVORITE_RECORDS_FETCHED',
          data: { records: [], nextCursor: null },
        });
      })
    );
    await getFavoriteRecords_IO({ cursor: 'c1', take: 10 });
    await getFavoriteRecords_IO(undefined);
    expect(urls.map(u => new URL(u).search)).toEqual([
      '?cursor=c1&take=10',
      '',
    ]);
  });

  it('a GET without query fields sends no query string', async () => {
    const urls: string[] = [];
    mswServer.use(
      http.get('*/api/v1/favorite/get-grouped', ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({
          event: 'FAVORITE_GROUPED_FETCHED',
          data: { groups: [] },
        });
      })
    );
    await getFavoriteGrouped_IO(undefined);
    expect(new URL(urls[0] ?? 'http://x/').search).toBe('');
  });
});
