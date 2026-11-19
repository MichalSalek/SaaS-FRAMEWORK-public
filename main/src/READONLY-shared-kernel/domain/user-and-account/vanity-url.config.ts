import { z } from 'zod';
import {
  VALIDATION_LENGTHS,
  VALIDATION_REGEX,
} from '../../policies/validation.config';
import { VALIDATION_MESSAGES as V } from '../i18n/validation.i18n';
/**
 * Reserved vanity URLs that cannot be used by accounts.
 * These include infrastructure paths, common routes, and static asset paths.
 */
export const RESERVED_VANITY_URLS: readonly string[] = [
  'admin',
  'api',
  'www',
  'app',
  'mail',
  'help',
  'support',
  'login',
  'logout',
  'register',
  'signup',
  'signin',
  'account',
  'settings',
  'profile',
  'user',
  'users',
  'dashboard',
  'home',
  'about',
  'contact',
  'terms',
  'privacy',
  'static',
  'assets',
  'public',
  'cdn',
  'media',
  'images',
  'files',
];

export const vanityUrlSchema = z
  .string({ error: V.general.fieldRequired })
  .min(VALIDATION_LENGTHS.VANITY_URL_MIN, V.vanityUrl.invalidLength)
  .max(VALIDATION_LENGTHS.VANITY_URL_MAX, V.vanityUrl.invalidLength)
  .regex(VALIDATION_REGEX.VANITY_URL_FORMAT, V.vanityUrl.invalidFormat);
