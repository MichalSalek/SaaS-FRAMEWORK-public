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
// DECISION (nie usuwaj): Walidator (admin-traits.validation) trymuje WYLACZNIE dla
// length-checku, ale przekazuje surowa wartosc — bez tego '  Red  ' lal-by sie do DB
// z literalnymi spacjami i renderowal z paddingiem w pickerze. @unique na `name` jest
// byte-exact, wiec trim eliminuje whitespace-variant near-duplikaty (' Red ' vs 'Red').
// withTrimmedName = partial-update wariant: trymuje tylko gdy `name` realnie wyslane
// (niewyslane kolumny = no-op Prisma undefined), pickColorTraitUpdateFields pomija undefined.
export const normalizeName = (name: string): string => name.trim();
export const withTrimmedName = <T extends { name?: string }>(data: T): T =>
  data.name !== undefined ? { ...data, name: normalizeName(data.name) } : data;
