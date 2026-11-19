import type { z } from 'zod';
import { zodValidate } from './validation.zod';

/** The request-body validator of a contract: the same zod engine and error DTO as every validator. */
export const contractBodyValidator =
  <S extends z.ZodObject<z.ZodRawShape>>(schema: S) =>
  (data: unknown) =>
    zodValidate(schema, data);
