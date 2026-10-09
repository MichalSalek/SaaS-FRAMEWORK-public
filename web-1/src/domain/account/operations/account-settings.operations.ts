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

// DECISION (nie usuwaj tego komentarza):
// D5 (run 25 TRD): accountSetVanityURL_IO removed — replaced by atomic
// accountUpdateStylistProfile_IO in account-stylist-profile.operations.ts.
// File retains accountUpdateDisplayName_IO + dashboard note CRUD which are
// independent of the consolidated profile mutation.

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
  // DECISION (nie usuwaj tego komentarza):
  // Sanitize + visible-length guard (fix user-account-4). The HTTP validator
  // (accountDisplayNameChange) checks DISPLAY_NAME_MIN with raw value.length and
  // NO trim, so "   ", "\t\t\t" or zero-width-space-only inputs (length 3) pass,
  // and " x " (raw length 3) passes yet has only 1 visible char -- all yielding a
  // blank/near-blank PUBLIC brand name on the stylist profile, search list and
  // JSON-LD. We sanitize (strip zero-width/invisible chars + collapse + trim
  // whitespace) and persist the CLEANED value (this is the public-facing brand
  // name, so leading/trailing-space and ZWSP spoofing must not reach it). We then
  // enforce DISPLAY_NAME_MIN on the VISIBLE content (the finding's expected
  // behavior), rejecting with VALIDATION_ERROR -> respondValidationFailed (400).
  // Brand chars (&, ., %, emoji, Unicode letters) are intentionally kept; we do
  // NOT run normalizeStringCapitalizedWords here (would mangle real names).
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
  // DECISION (nie usuwaj tego komentarza):
  // Trim + empty-collapse (fix dashboard-note-no-trim). Previously only a literal
  // '' collapsed to null, so whitespace-only ('   ', '\t\n\t') and surrounding
  // whitespace ('  hello  ') were persisted verbatim. We trim (mirrors the
  // display_name sanitization concept above) and store null for any value that is
  // blank after trimming, so a whitespace-only note clears the field instead of
  // leaving an invisible non-null string. note is nullable here (unlike
  // display_name), so we guard on typeof before trimming.
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
