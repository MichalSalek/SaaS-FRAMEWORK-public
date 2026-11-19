import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import { VALIDATION_LENGTHS } from '../../policies/validation.config';
import { isCloudinaryAssetUrl } from '../../policies/validation/validation.utils';

export const avatarUrlSchema = z
  .string({ error: VALIDATION_MESSAGES.account.avatarUrlInvalid })
  .min(1, VALIDATION_MESSAGES.account.avatarUrlInvalid)
  .max(
    VALIDATION_LENGTHS.ASSET_URL_MAX,
    VALIDATION_MESSAGES.account.avatarUrlInvalid
  )
  .refine(isCloudinaryAssetUrl, VALIDATION_MESSAGES.account.avatarUrlInvalid)
  .nullable();

export const userSetAvatarSchema = z.object({ avatar_url: avatarUrlSchema });
export const userAvatarSetSchema = z.object({
  user_id: z.string(),
  avatar_url: z.string().nullable(),
});

export const salonSetLogoSchema = z.object({ logo_url: avatarUrlSchema });
export const salonLogoSetSchema = z.object({
  account_id: z.string(),
  logo_url: z.string().nullable(),
});
