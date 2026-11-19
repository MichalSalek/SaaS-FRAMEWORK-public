import { z } from 'zod';
import { wireInstant } from '../../application/contracts/wire-values';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import { currentUserResponseSchema } from '../user/user.contract-schemas';

const V = VALIDATION_MESSAGES;

export const emptyResponse = z.undefined();

// Empty string rejects. Same object the admin-users deleteSession validator still copies locally.
export const sessionDeleteExactlySchema = z.object({
  id: z.string({ error: V.session.missingId }).min(1, V.session.missingId),
});

// No id logs the caller out. A provided id must be a string so an operator object cannot
// reach deleteMany as a StringFilter. The empty string still passes, as it always did.
export const sessionDeleteAllSchema = z.object({
  id: z.string({ error: V.user.invalidId }).optional(),
});

const sessionRowSchema = z.object({
  id: z.string(),
  expires: wireInstant,
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  device_type: z.string().nullable(),
  createdAt: wireInstant,
  updatedAt: wireInstant,
  is_current: z.boolean(),
});

export const sessionListSchema = z.object({
  sessions: z.array(sessionRowSchema),
  nextCursor: z.string().nullable(),
});

export const currentSessionUserSchema = currentUserResponseSchema;
