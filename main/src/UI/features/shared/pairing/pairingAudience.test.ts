import { describe, expect, it } from 'vitest';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { resolvePairingAudience } from './pairingAudience';

const client = {
  authLoading: false,
  hasUser: true,
  accountResolved: true,
  accountType: AccountTypeValue.CLIENT,
  ownProfile: false,
  hasClientAccount: true,
  accessChecked: true,
  accessFetching: false,
  accessFailed: false,
  isPaired: false,
  isPending: false,
};

describe('pairing audience', () => {
  it.each([
    [{ authLoading: true, hasUser: false }, 'checking'],
    [{ hasUser: false }, 'guest'],
    [{ accountResolved: false }, 'checking'],
    [{ accountType: null }, 'checking'],
    [{ ownProfile: true, accountType: AccountTypeValue.CLIENT }, 'owner'],
    [
      {
        accountType: AccountTypeValue.STYLIST,
        hasClientAccount: true,
        isPaired: true,
      },
      'stylistWithClient',
    ],
    [
      { accountType: AccountTypeValue.STYLIST, hasClientAccount: false },
      'stylistNoClient',
    ],
    [{ hasClientAccount: false }, 'clientOnboarding'],
    [{ accessChecked: false }, 'checking'],
    [{ accessFetching: true }, 'checking'],
    [{ accessFailed: true, accessChecked: true }, 'accessFailed'],
    [{}, 'clientPublic'],
    [{ isPending: true }, 'clientPending'],
    [{ isPaired: true }, 'clientPaired'],
    [{ isPaired: true, accessFetching: true }, 'clientPaired'],
    [{ isPending: true, accessFetching: true }, 'clientPending'],
  ] as const)('resolves %j as %s', (changes, expected) => {
    expect(resolvePairingAudience({ ...client, ...changes })).toBe(expected);
  });
});
