// Compile-time: a required query rejects a missing argument and a missing key. An all-optional
// query call still accepts undefined. Runtime: a confirmation GET puts the body token on the
// query, and an id list repeats the query key.
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import type {
  ContractClientRequest,
  ContractRequest,
} from '@kernel/application/contracts/contract.types';
import type { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import type { CLIENT_CONTRACTS } from '@kernel/domain/client/client.contracts';
import type { FAVORITE_CONTRACTS } from '@kernel/domain/favorites/favorite.contracts';
import { GALLERY_CONTRACTS } from '@kernel/domain/gallery/gallery.contracts';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { mswServer } from '../../test-utils/msw/server';
import { contractEndpoint } from './io';

type CrmClient = ContractClientRequest<
  (typeof CLIENT_CONTRACTS)['CLIENT_GET_CRM_NOTE']
>;
type CrmRequest = ContractRequest<
  (typeof CLIENT_CONTRACTS)['CLIENT_GET_CRM_NOTE']
>;
type ListClient = ContractClientRequest<
  (typeof FAVORITE_CONTRACTS)['FAVORITE_GET_RECORDS']
>;
type ListRequest = ContractRequest<
  (typeof FAVORITE_CONTRACTS)['FAVORITE_GET_RECORDS']
>;
type ConfirmClient = ContractClientRequest<
  (typeof USER_CONTRACTS)['USER_DELETE_CONFIRM']
>;
type LogDetailsClient = ContractClientRequest<
  (typeof ADMIN_CONTRACTS)['ADMIN_GET_LOG_DETAILS']
>;

type Holds<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;

const witness: {
  crmClientRejectsUndefined: Holds<undefined extends CrmClient ? false : true>;
  crmRequestRejectsUndefined: Holds<
    undefined extends CrmRequest ? false : true
  >;
  crmRejectsEmptyObject: Holds<
    Extends<Record<string, never>, CrmClient> extends true ? false : true
  >;
  crmAcceptsId: Holds<Extends<{ client_user_id: string }, CrmClient>>;
  crmRequestAcceptsId: Holds<Extends<{ client_user_id: string }, CrmRequest>>;
  optionalCallAcceptsUndefined: Holds<
    undefined extends ListClient ? true : false
  >;
  optionalObjectStaysDefined: Holds<
    undefined extends ListRequest ? false : true
  >;
  confirmCarriesToken: Holds<Extends<{ token: string }, ConfirmClient>>;
  confirmRejectsUndefined: Holds<
    undefined extends ConfirmClient ? false : true
  >;
  logDetailsRequiresNumericId: Holds<Extends<{ id: number }, LogDetailsClient>>;
  logDetailsRejectsStringId: Holds<
    Extends<{ id: string }, LogDetailsClient> extends true ? false : true
  >;
  logDetailsRejectsUndefined: Holds<
    undefined extends LogDetailsClient ? false : true
  >;
} = {
  crmClientRejectsUndefined: true,
  crmRequestRejectsUndefined: true,
  crmRejectsEmptyObject: true,
  crmAcceptsId: true,
  crmRequestAcceptsId: true,
  optionalCallAcceptsUndefined: true,
  optionalObjectStaysDefined: true,
  confirmCarriesToken: true,
  confirmRejectsUndefined: true,
  logDetailsRequiresNumericId: true,
  logDetailsRejectsStringId: true,
  logDetailsRejectsUndefined: true,
};

describe('contract client requiredness and confirmation query', () => {
  it('keeps the required-query witness', () => {
    expect(witness.crmClientRejectsUndefined).toBe(true);
    expect(witness.crmAcceptsId).toBe(true);
    expect(witness.optionalCallAcceptsUndefined).toBe(true);
  });

  it('encodes a confirmation token as a GET query', async () => {
    let seen: { method: string; search: string; body: string } | null = null;
    mswServer.use(
      http.get('*/api/v1/user/delete/confirm', async ({ request }) => {
        seen = {
          method: request.method,
          search: new URL(request.url).search,
          body: await request.text(),
        };
        return HttpResponse.json({
          event: 'USER_DELETE_CONFIRMED',
          data: { confirmed: true },
        });
      })
    );
    const confirm = contractEndpoint(USER_CONTRACTS.USER_DELETE_CONFIRM);
    await confirm({ token: 'abc def' });
    expect(seen).toEqual({
      method: 'GET',
      search: '?token=abc%20def',
      body: '',
    });
  });

  it('repeats an id-list query key', async () => {
    const searches: string[] = [];
    mswServer.use(
      http.get('*/api/v1/gallery/explore', ({ request }) => {
        searches.push(new URL(request.url).search);
        return HttpResponse.json({
          event: 'EXPLORE_GALLERY_RECORDS_FETCHED',
          data: { records: [], nextCursor: null },
        });
      })
    );
    const explore = contractEndpoint(GALLERY_CONTRACTS.EXPLORE_GALLERY_RECORDS);
    await explore({ color_ids: ['red', 'blue'], take: 12 });
    expect(searches).toEqual(['?color_ids=red&color_ids=blue&take=12']);
  });
});
