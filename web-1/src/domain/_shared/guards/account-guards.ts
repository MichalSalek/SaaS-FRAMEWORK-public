// Account guards — reusable typed checks for account presence and status
// Usage: const result = requireStylistAccount(currentUser); if (!result.success) return mapErrorToResponse(res, result.error);

import type {
  StylistAccount,
  ClientAccount,
} from '@kernel/models/db_models.generated.dto';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import type { CurrentUser } from '@kernel/models/user/user.types';
import type { UnauthorizedError } from '@kernel/application/common-errors.types';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import { USER_POLICY } from '@kernel/policies/user.policy';

type WrongAccountTypeError = Extract<
  UnauthorizedError,
  { reason: 'WRONG_ACCOUNT_TYPE' }
>;

type AccountInactiveError = Extract<
  UnauthorizedError,
  { reason: 'ACCOUNT_INACTIVE' }
>;

export function requireStylistAccount(
  currentUser: CurrentUser
): OperationResult<
  StylistAccount,
  WrongAccountTypeError | AccountInactiveError
> {
  if (!currentUser.stylist_account) {
    return failure({
      type: 'UNAUTHORIZED',
      reason: 'WRONG_ACCOUNT_TYPE',
      requiredAccountType: AccountTypeValue.STYLIST,
    });
  }

  const account = currentUser.stylist_account;

  // Presence is checked above (WRONG_ACCOUNT_TYPE); here we gate on the multi-state
  // active set via the kernel SSOT (IS_USER_HAS_ACTIVE_ACCOUNT = stylist_account ∈
  // activeAccountStates). The presence + active split keeps the two distinct error
  // reasons (WRONG_ACCOUNT_TYPE vs ACCOUNT_INACTIVE) that one boolean would collapse.
  if (!USER_POLICY.utils.IS_USER_HAS_ACTIVE_ACCOUNT({ user: currentUser })) {
    return failure({
      type: 'UNAUTHORIZED',
      reason: 'ACCOUNT_INACTIVE',
      currentStatus: account.account_status,
    });
  }

  return success(account);
}

export function requireClientAccount(
  currentUser: CurrentUser
): OperationResult<ClientAccount, WrongAccountTypeError> {
  if (!currentUser.client_account) {
    return failure({
      type: 'UNAUTHORIZED',
      reason: 'WRONG_ACCOUNT_TYPE',
      requiredAccountType: AccountTypeValue.CLIENT,
    });
  }
  return success(currentUser.client_account);
}
