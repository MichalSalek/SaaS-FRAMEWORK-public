import { adminGetReportsSchema } from '../../domain/admin/admin.contract-schemas';
import { zodValidate } from './validation.zod';

export const adminReportsValidators = {
  adminGetReports: (data: unknown) => zodValidate(adminGetReportsSchema, data),
} as const;
