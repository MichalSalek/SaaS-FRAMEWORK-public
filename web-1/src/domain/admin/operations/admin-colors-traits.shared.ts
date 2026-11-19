import type {
  AdminTargetNotFoundError,
  AdminInsufficientPermissionsError,
  AdminResourceHasReferencesError,
  AdminDuplicateResourceNameError,
} from '@kernel/domain/admin/admin-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';

/**
 * Shared types + name-normalization for admin Color / Trait mutations.
 *
 * Split z admin-colors-traits.operations.ts dla utrzymania ESLint max-lines (350) —
 * operacje rozbite na admin-colors.operations.ts + admin-traits.operations.ts; ten plik
 * trzyma wspolny error-union i helpery trymowania nazwy uzywane przez obie strony.
 */
export type ColorTraitError =
  | AdminTargetNotFoundError
  | AdminInsufficientPermissionsError
  | AdminResourceHasReferencesError
  | AdminDuplicateResourceNameError
  | DatabaseError;

// name trymowany przed persystencja (mirror admin-announcements.operations.ts).
// DECISION: the validator trims only for its length check and passes the raw value on, so the
// name is trimmed here; otherwise '  Red  ' is stored padded and, since @unique on `name` is
// byte-exact, ' Red ' and 'Red' coexist. withTrimmedName trims only when `name` was sent.
export const normalizeName = (name: string): string => name.trim();
export const withTrimmedName = <T extends { name?: string }>(data: T): T =>
  data.name !== undefined ? { ...data, name: normalizeName(data.name) } : data;
