import { ENV_VARS } from '@app/environment/environment.config';
import type { User } from '@kernel/models/db_models.generated.dto';

/**
 * Parse comma-separated admin emails from MASTER_ADMIN_EMAIL env var.
 * Supports multi-admin: "admin1@email.com,admin2@email.com"
 */
const parseAdminEmails = (): Set<string> => {
  const raw = ENV_VARS.MASTER_ADMIN_EMAIL || '';
  return new Set(
    raw
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean)
  );
};

// DECISION (nie usuwaj tego komentarza):
// Lazy memo + cache invalidation when env changes at runtime.
// Module-level capture at boot było problematyczne — RuntimeConfig/env mutations
// w trakcie procesu nie były reactive.
let _adminEmailSet: Set<string> | null = null;
let _adminEmailSetEnv: string | undefined = undefined;
const getAdminEmailSet = (): Set<string> => {
  const currentEnv = ENV_VARS.MASTER_ADMIN_EMAIL;
  if (_adminEmailSet === null || _adminEmailSetEnv !== currentEnv) {
    _adminEmailSet = parseAdminEmails();
    _adminEmailSetEnv = currentEnv;
  }
  return _adminEmailSet;
};

/** Get all configured admin emails */
export const getAdminEmails = (): string[] => Array.from(getAdminEmailSet());

/** Get primary (first) admin email — for notifications, alerts */
export const getPrimaryAdminEmail = (): string | undefined =>
  getAdminEmails()[0];

/** Check if email belongs to a configured admin */
export const isAdminEmail = (email: string): boolean => {
  return getAdminEmailSet().has(email.trim().toLowerCase());
};

/** Block registration with admin emails */
export const isEmailAddressProhibited = (email: User['email']): boolean => {
  return isAdminEmail(email);
};
