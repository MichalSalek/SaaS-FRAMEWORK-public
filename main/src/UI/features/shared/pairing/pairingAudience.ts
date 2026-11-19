import type { AccountType } from '@kernel/models/db_models.generated.dto';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';

/** Identity and access, not whether a particular button is enabled. */
export type PairingAudience =
  | 'checking'
  | 'guest'
  | 'owner'
  | 'stylistWithClient'
  | 'stylistNoClient'
  | 'clientOnboarding'
  | 'clientPublic'
  | 'clientPending'
  | 'clientPaired'
  | 'accessFailed';

export function resolvePairingAudience(input: {
  authLoading: boolean;
  hasUser: boolean;
  accountResolved: boolean;
  accountType: AccountType | null;
  ownProfile: boolean;
  hasClientAccount: boolean;
  accessChecked: boolean;
  accessFetching: boolean;
  accessFailed: boolean;
  isPaired: boolean;
  isPending: boolean;
}): PairingAudience {
  if (input.authLoading) {
    return 'checking';
  }
  if (!input.hasUser) {
    return 'guest';
  }
  if (!input.accountResolved) {
    return 'checking';
  }
  if (input.ownProfile) {
    return 'owner';
  }
  if (input.accountType === AccountTypeValue.STYLIST) {
    return input.hasClientAccount ? 'stylistWithClient' : 'stylistNoClient';
  }
  if (input.accountType !== AccountTypeValue.CLIENT) {
    return 'checking';
  }
  if (!input.hasClientAccount) {
    return 'clientOnboarding';
  }
  if (input.accessFailed) {
    return 'accessFailed';
  }
  if (
    !input.accessChecked ||
    (input.accessFetching && !input.isPaired && !input.isPending)
  ) {
    return 'checking';
  }
  if (input.isPaired) {
    return 'clientPaired';
  }
  return input.isPending ? 'clientPending' : 'clientPublic';
}
