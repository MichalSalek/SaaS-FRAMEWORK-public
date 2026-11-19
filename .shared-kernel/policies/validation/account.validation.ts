import type { z } from 'zod';
import type { ACCOUNT_DTO_API_V1 } from '../../models/account/account.dto';
import {
  accountDisplayNameChangeSchema,
  accountGetStylistsWithLocationSchema,
  accountIncrementViewSchema,
  accountSetAvatarSchema,
  accountSetDashboardNoteSchema,
  vatInvoiceDetailsSchema,
} from '../../domain/account/account.contract-schemas';
import {
  zodValidate,
  zodValidateWithErrorSlots,
  type AssertTrue,
  type SchemaMatchesDto,
  type ParsedData,
} from './validation.zod';
import {
  UPDATE_STYLIST_PROFILE_ERROR_SLOTS,
  updateStylistProfileSchema,
} from './stylist-profile.validation';

export const accountValidators = {
  accountDisplayNameChange: (data: unknown) =>
    zodValidate(accountDisplayNameChangeSchema, data),
  accountGetStylistsWithLocation: (data: unknown) =>
    zodValidate(accountGetStylistsWithLocationSchema, data),
  updateStylistProfile: (data: unknown) =>
    zodValidateWithErrorSlots(
      updateStylistProfileSchema,
      UPDATE_STYLIST_PROFILE_ERROR_SLOTS,
      data
    ),
  accountSetAvatar: (data: unknown) =>
    zodValidate(accountSetAvatarSchema, data),
  accountIncrementView: (data: unknown) =>
    zodValidate(accountIncrementViewSchema, data),
  accountSetDashboardNote: (data: unknown) =>
    zodValidate(accountSetDashboardNoteSchema, data),
  vatInvoiceDetails: (data: unknown) =>
    zodValidate(vatInvoiceDetailsSchema, data),
} as const;

// DECISION: two validators stay outside the witness.
//  1. accountDisplayNameChange: the REQUEST DTO types display_name as string | null, but runtime
//     rejects null. The schema is z.string(), stricter than the DTO.
//  2. updateStylistProfile: sections are z.custom carriers gated by a superRefine, and the error
//     slots are declared apart from the shape (DECISION on the schema).
export type AccountRequestSchemaBindings = {
  accountGetStylistsWithLocation: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof accountGetStylistsWithLocationSchema>,
      ACCOUNT_DTO_API_V1['ACCOUNT_GET_STYLISTS_WITH_LOCATION']['REQUEST']
    >
  >;
  accountSetAvatar: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof accountSetAvatarSchema>,
      ACCOUNT_DTO_API_V1['ACCOUNT_SET_AVATAR']['REQUEST']
    >
  >;
  accountIncrementView: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof accountIncrementViewSchema>,
      ACCOUNT_DTO_API_V1['ACCOUNT_INCREMENT_VIEW']['REQUEST']
    >
  >;
  accountSetDashboardNote: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof accountSetDashboardNoteSchema>,
      ACCOUNT_DTO_API_V1['ACCOUNT_SET_DASHBOARD_NOTE']['REQUEST']
    >
  >;
  vatInvoiceDetails: AssertTrue<
    SchemaMatchesDto<
      ParsedData<z.infer<typeof vatInvoiceDetailsSchema>>,
      ACCOUNT_DTO_API_V1['ACCOUNT_VAT_INVOICE_DETAILS']['REQUEST']
    >
  >;
};
