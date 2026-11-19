import { DB_CLIENT } from '@app/db/db.client';
import type { IDType } from '@kernel/application/application.types';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import type {
  AccountType,
  StylistAccount,
} from '@kernel/models/db_models.generated.dto';
import { narrowStylistAccount } from '@kernel/models/type_narrowing';
import { isP2025 } from '@app/db/prisma-error';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  AccountNotFoundError,
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { sanitizePublicBrandName } from './account-settings.helper';
import { assignAutoVanityUrl_IO } from '../vanity-url.auto';

export const accountUpdateDisplayName_IO = async ({
  id,
  display_name,
}: {
  id: IDType;
  display_name: string;
}): Promise<
  OperationResult<
    StylistAccount,
    AccountNotFoundError | ValidationError | DatabaseError
  >
> => {
  // DECISION: the HTTP validator checks DISPLAY_NAME_MIN on the raw, untrimmed value, so "   " or a
  // zero-width-only name passes. We persist the sanitized value and enforce the minimum on its
  // VISIBLE length (400 otherwise). Why not normalizeStringCapitalizedWords: see
  // account-settings.helper.ts.
  const sanitizedDisplayName = sanitizePublicBrandName(display_name);
  if (
    !VALIDATION_POLICY.utils.validateByMinLength(
      sanitizedDisplayName,
      VALIDATION_LENGTHS.DISPLAY_NAME_MIN
    )
  ) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'display_name',
      message: `Display name must contain at least ${VALIDATION_LENGTHS.DISPLAY_NAME_MIN} visible characters`,
    });
  }

  let account;
  try {
    account = await DB_CLIENT.use.stylistAccount.update({
      where: {
        created_by_user_id: id,
      },
      data: {
        display_name: sanitizedDisplayName,
      },
    });
  } catch (error: unknown) {
    if (isP2025(error)) {
      return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: String(id) });
    }
    return databaseFailure('accountUpdateDisplayName_IO', error);
  }

  const result = narrowStylistAccount(account, 'accountUpdateDisplayName_IO');
  if (!result) {
    return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: String(id) });
  }
  // A stylist who onboarded without a name (role-only onboarding, owner
  // 2026-10-15) gets her public address the moment she names herself, the
  // same way onboarding gives it. Best-effort and fills an EMPTY address only.
  if (!result.vanity_url) {
    await assignAutoVanityUrl_IO(result.account_id, [
      result.instagram_handle,
      sanitizedDisplayName,
    ]);
  }
  return success(result);
};

type DashboardNoteResponse =
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_NOTE']['RESPONSE'];

export const getDashboardNote_IO = async ({
  stylist_account_id,
  client_account_id,
}: {
  stylist_account_id: string | undefined;
  client_account_id: string | undefined;
}): Promise<OperationResult<DashboardNoteResponse, DatabaseError>> => {
  try {
    const [stylistNote, clientNote] = await Promise.all([
      stylist_account_id
        ? DB_CLIENT.use.stylistAccount.findUnique({
            where: { account_id: stylist_account_id },
            select: { dashboard_note: true },
          })
        : null,
      client_account_id
        ? DB_CLIENT.use.clientAccount.findUnique({
            where: { client_account_id },
            select: { dashboard_note: true },
          })
        : null,
    ]);

    return success({
      stylist_note: stylistNote?.dashboard_note ?? null,
      client_note: clientNote?.dashboard_note ?? null,
    });
  } catch (error) {
    return databaseFailure('getDashboardNote_IO', error);
  }
};

export const setDashboardNote_IO = async ({
  user_id,
  account_type,
  note,
  stylist_account_id,
  client_account_id,
}: {
  user_id: IDType;
  account_type: AccountType;
  note: string | null;
  stylist_account_id: string | undefined;
  client_account_id: string | undefined;
}): Promise<
  OperationResult<
    { dashboard_note: string | null },
    AccountNotFoundError | DatabaseError
  >
> => {
  // A note that is blank after trimming is stored as null (clears the field).
  const trimmedNote = typeof note === 'string' ? note.trim() : note;
  const normalizedNote = trimmedNote ? trimmedNote : null;

  try {
    if (account_type === AccountTypeValue.STYLIST) {
      if (!stylist_account_id) {
        return failure({
          type: 'ACCOUNT_NOT_FOUND',
          accountId: String(user_id),
        });
      }
      const updated = await DB_CLIENT.use.stylistAccount.update({
        where: { account_id: stylist_account_id },
        data: { dashboard_note: normalizedNote },
        select: { dashboard_note: true },
      });

      return success({ dashboard_note: updated.dashboard_note });
    }

    if (!client_account_id) {
      return failure({
        type: 'ACCOUNT_NOT_FOUND',
        accountId: String(user_id),
      });
    }
    const updated = await DB_CLIENT.use.clientAccount.update({
      where: { client_account_id },
      data: { dashboard_note: normalizedNote },
      select: { dashboard_note: true },
    });

    return success({ dashboard_note: updated.dashboard_note });
  } catch (error: unknown) {
    if (isP2025(error)) {
      return failure({
        type: 'ACCOUNT_NOT_FOUND',
        accountId: String(user_id),
      });
    }
    return databaseFailure('setDashboardNote_IO', error);
  }
};
