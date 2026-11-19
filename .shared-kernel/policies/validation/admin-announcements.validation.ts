import type { z } from 'zod';
import {
  adminCreateAnnouncementSchema,
  adminDeleteAnnouncementSchema,
  adminUpdateAnnouncementSchema,
} from '../../domain/admin/admin.contract-schemas';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import { NO_VALIDATION } from './validation.types';
import {
  zodValidate,
  type AssertTrue,
  type ParsedData,
  type SchemaMatchesDto,
} from './validation.zod';

export const adminAnnouncementsValidators = {
  adminGetAnnouncements: NO_VALIDATION,
  adminCreateAnnouncement: (data: unknown) =>
    zodValidate(adminCreateAnnouncementSchema, data),
  adminUpdateAnnouncement: (data: unknown) =>
    zodValidate(adminUpdateAnnouncementSchema, data),
  adminDeleteAnnouncement: (data: unknown) =>
    zodValidate(adminDeleteAnnouncementSchema, data),
  announcementsGetActive: NO_VALIDATION,
} as const;

export type AdminAnnouncementsRequestSchemaBindings = {
  adminCreateAnnouncement: AssertTrue<
    SchemaMatchesDto<
      ParsedData<z.infer<typeof adminCreateAnnouncementSchema>>,
      ADMIN_DTO_API_V1['ADMIN_CREATE_ANNOUNCEMENT']['REQUEST']
    >
  >;
  adminUpdateAnnouncement: AssertTrue<
    SchemaMatchesDto<
      ParsedData<z.infer<typeof adminUpdateAnnouncementSchema>>,
      ADMIN_DTO_API_V1['ADMIN_UPDATE_ANNOUNCEMENT']['REQUEST']
    >
  >;
  adminDeleteAnnouncement: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminDeleteAnnouncementSchema>,
      ADMIN_DTO_API_V1['ADMIN_DELETE_ANNOUNCEMENT']['REQUEST']
    >
  >;
};
