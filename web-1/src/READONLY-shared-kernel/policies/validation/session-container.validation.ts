import type { z } from 'zod';
import type { SESSION_CONTAINER_DTO_API_V1 } from '../../models/session-container/session-container.dto';
import {
  sessionContainerAddPhotoSchema,
  sessionContainerCloseSchema,
  sessionContainerCreateSchema,
  sessionContainerRemovePhotoSchema,
  sessionContainerSetNoteSchema,
  sessionContainerShareSchema,
} from '../../domain/session-container/session-container.contract-schemas';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';
import { NO_VALIDATION } from './validation.types';

export const sessionContainerValidators = {
  sessionContainerCreate: (data: unknown) =>
    zodValidate(sessionContainerCreateSchema, data),
  sessionContainerAddPhoto: (data: unknown) =>
    zodValidate(sessionContainerAddPhotoSchema, data),
  sessionContainerRemovePhoto: (data: unknown) =>
    zodValidate(sessionContainerRemovePhotoSchema, data),
  sessionContainerShare: (data: unknown) =>
    zodValidate(sessionContainerShareSchema, data),
  sessionContainerClose: (data: unknown) =>
    zodValidate(sessionContainerCloseSchema, data),
  // Bodyless GET. cursor/take are query fields on the contract, not this parser.
  sessionContainerGetMy: NO_VALIDATION,
  sessionContainerSetNote: (data: unknown) =>
    zodValidate(sessionContainerSetNoteSchema, data),
} as const;

export type SessionContainerRequestSchemaBindings = {
  sessionContainerCreate: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof sessionContainerCreateSchema>,
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['REQUEST']
    >
  >;
  sessionContainerAddPhoto: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof sessionContainerAddPhotoSchema>,
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_ADD_PHOTO']['REQUEST']
    >
  >;
  sessionContainerRemovePhoto: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof sessionContainerRemovePhotoSchema>,
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_REMOVE_PHOTO']['REQUEST']
    >
  >;
  sessionContainerShare: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof sessionContainerShareSchema>,
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SHARE']['REQUEST']
    >
  >;
  sessionContainerClose: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof sessionContainerCloseSchema>,
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CLOSE']['REQUEST']
    >
  >;
  sessionContainerSetNote: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof sessionContainerSetNoteSchema>,
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SET_NOTE']['REQUEST']
    >
  >;
};
