import { describe, expect, it } from 'vitest';
import { contractEndpoint } from './io';
import type { contractPathEndpoint } from './io';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../../test-utils/msw/server';
import type {
  ContractRequest,
  ContractClientRequest,
} from '@kernel/application/contracts/contract.types';
import { CLIENT_CONTRACTS } from '@kernel/domain/client/client.contracts';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import type { FAVORITE_CONTRACTS } from '@kernel/domain/favorites/favorite.contracts';

const requiredQueryCall = contractEndpoint(
  CLIENT_CONTRACTS.CLIENT_GET_CRM_NOTE
);
type RequiredQuery = typeof CLIENT_CONTRACTS.CLIENT_GET_CRM_NOTE;
type Confirmation = typeof USER_CONTRACTS.USER_DELETE_CONFIRM;
type EmailConfirmation = typeof USER_CONTRACTS.USER_EMAIL_CHANGE_CONFIRM;
type Accepts<FactoryInput, Input> = Input extends FactoryInput ? true : false;
type ClientInput = Parameters<typeof contractEndpoint>[0];
type PathInput = Parameters<typeof contractPathEndpoint>[0];

// These values must satisfy the real factory signatures and DTO types at compile time.
const witness: {
  missingRequiredCall: Accepts<
    Parameters<typeof requiredQueryCall>[0],
    undefined
  >;
  missingRequiredDto: Accepts<ContractRequest<RequiredQuery>, undefined>;
  missingRequiredClientQuery: Accepts<
    ContractClientRequest<RequiredQuery>,
    undefined
  >;
  validRequiredQuery: Accepts<
    ContractClientRequest<RequiredQuery>,
    { client_user_id: string }
  >;
  confirmation: Accepts<ClientInput, Confirmation>;
  emailConfirmation: Accepts<ClientInput, EmailConfirmation>;
  pathConfirmation: Accepts<PathInput, Confirmation>;
  query: Accepts<ClientInput, typeof FAVORITE_CONTRACTS.FAVORITE_GET_RECORDS>;
} = {
  missingRequiredCall: false,
  missingRequiredDto: false,
  missingRequiredClientQuery: false,
  validRequiredQuery: true,
  confirmation: true,
  emailConfirmation: true,
  pathConfirmation: true,
  query: true,
};

describe('contract client input boundaries', () => {
  it('requires required query input and supports confirmation contracts', () => {
    expect(witness).toEqual({
      missingRequiredCall: false,
      missingRequiredDto: false,
      missingRequiredClientQuery: false,
      validRequiredQuery: true,
      confirmation: true,
      emailConfirmation: true,
      pathConfirmation: true,
      query: true,
    });
  });
  it('encodes a confirmation token into GET query without a request body', async () => {
    const token = 'test+token/&?=';
    const seen: { token: string | null; body: string }[] = [];
    mswServer.use(
      http.get('*/api/v1/user/delete/confirm', async ({ request }) => {
        seen.push({
          token: new URL(request.url).searchParams.get('token'),
          body: await request.text(),
        });
        return HttpResponse.json({
          event: 'USER_DELETE_CONFIRMED',
          data: { confirmed: true },
        });
      })
    );
    const confirm = contractEndpoint(USER_CONTRACTS.USER_DELETE_CONFIRM);
    await expect(confirm({ token })).resolves.toEqual({ confirmed: true });
    expect(seen).toEqual([{ token, body: '' }]);
  });
});
