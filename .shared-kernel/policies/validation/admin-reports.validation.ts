import { z } from 'zod';
import { REPORT_PERIODS } from '../../domain/admin/admin.config';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// period where the original distinguishes "missing" (falsy) from "invalid value"
// (truthy but not a member of REPORT_PERIODS). Faithful port of the hand-written
// branches:
//   if (!typedData?.period)               → V.report.periodRequired   (undefined/null/'')
//   else if (!REPORT_PERIODS.includes(p)) → V.report.periodInvalid    (any truthy non-member,
//                                                                       incl. truthy non-string)
// z.enum() (default zod object, non-strict) reproduces every characterization case:
//   missing / null / undefined / '' → falsy → periodRequired
//   'year' / 'WEEK' / 1 / true / {} / ['week'] → truthy non-member → periodInvalid
// The error `input` is the raw value zod received; `issue.input` is truthy iff the
// original `!value` check would have been false → periodInvalid branch.
const periodEnum = z.enum(REPORT_PERIODS, {
  error: issue => {
    const hasInput = Boolean(issue.input);
    return hasInput ? V.report.periodInvalid : V.report.periodRequired;
  },
});

const adminGetReportsSchema = z.object({
  period: periodEnum,
});

export const adminReportsValidators = {
  adminGetReports: (data: unknown) => zodValidate(adminGetReportsSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per domain; each property fails to compile if the schema's
// inferred output drifts from its REQUEST DTO. Exported so it is never flagged unused.
export type AdminReportsRequestSchemaBindings = {
  adminGetReports: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminGetReportsSchema>,
      ADMIN_DTO_API_V1['ADMIN_GET_REPORTS']['REQUEST']
    >
  >;
};
