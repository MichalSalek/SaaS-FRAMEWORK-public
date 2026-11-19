import { DB_CLIENT } from '@app/db/db.client';
import { escapeLikePattern } from '@app/db/like-escape';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type { AdminDuplicateResourceNameError } from '@kernel/domain/admin/admin-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { hasCode } from '@kernel/models/type_narrowing';
import type { TraitCategory } from '@kernel/models/db_models.manual.dto';

export const pickColorUpdateFields = (data: {
  name?: string;
  hex_code?: string;
  display_order?: number;
  is_active?: boolean;
}) => ({
  ...(data.name !== undefined && { name: data.name }),
  ...(data.hex_code !== undefined && { hex_code: data.hex_code }),
  ...(data.display_order !== undefined && {
    display_order: data.display_order,
  }),
  ...(data.is_active !== undefined && { is_active: data.is_active }),
});

export const pickTraitUpdateFields = (data: {
  name?: string;
  category?: TraitCategory;
  icon_url?: string;
  display_order?: number;
  is_active?: boolean;
  is_featured?: boolean;
}) => ({
  ...(data.name !== undefined && { name: data.name }),
  ...(data.category !== undefined && { category: data.category }),
  ...(data.icon_url !== undefined && { icon_url: data.icon_url }),
  ...(data.display_order !== undefined && {
    display_order: data.display_order,
  }),
  ...(data.is_active !== undefined && { is_active: data.is_active }),
  ...(data.is_featured !== undefined && { is_featured: data.is_featured }),
});

export const dupNameError = (
  resourceType: 'COLOR' | 'TRAIT',
  name: string | undefined
): AdminDuplicateResourceNameError => ({
  type: 'ADMIN_DUPLICATE_RESOURCE_NAME',
  resourceType,
  name: name ?? '',
});

/**
 * Case-insensitive name-conflict pre-check dla admin Color / Trait.
 *
 * DECISION: this pre-check is the ONLY guard against case variants ('Red' vs 'RED'), not a
 * duplicate of the P2002 catch: @unique on `name` is byte-exact and would store both, which
 * stylists see as two picker entries. Storage keeps the original spelling (detect, never
 * lowercase). It is not atomic with the write, so @unique + P2002 stay as the exact-duplicate
 * race backstop until a LOWER(name) index exists. excludeId skips the record being renamed.
 */
type Finder = (w: {
  name: { equals: string; mode: 'insensitive' };
  id?: { not: string };
}) => Promise<{ id: string } | null>;
const nameConflict =
  (find: Finder, resourceType: 'COLOR' | 'TRAIT') =>
  async (
    rawName: string | undefined,
    excludeId?: string
  ): Promise<AdminDuplicateResourceNameError | null> => {
    if (rawName === undefined) {
      return null;
    }
    const found = await find({
      // escapeLikePattern: `equals` + mode:'insensitive' compiles to ILIKE — escape so the
      // uniqueness check matches the name LITERALLY (a `%`/`_` in a name must not act as a
      // wildcard) and a trailing `\` cannot crash the check with an unmapped 500.
      name: { equals: escapeLikePattern(rawName.trim()), mode: 'insensitive' },
      ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
    });
    return found !== null ? dupNameError(resourceType, rawName) : null;
  };
export const colorNameConflict = nameConflict(
  w => DB_CLIENT.use.color.findFirst({ where: w, select: { id: true } }),
  'COLOR'
);
export const traitNameConflict = nameConflict(
  w => DB_CLIENT.use.trait.findFirst({ where: w, select: { id: true } }),
  'TRAIT'
);

// DECISION: P2002 on Color/Trait can only be a `name` collision (the sole @unique; `id` is not
// assignable through the pick helpers). It stays as the backstop for the race between the
// case-insensitive pre-check and the write.
const isP2002 = (e: unknown): boolean => hasCode(e) && e.code === 'P2002';
export const dbOrDupFailure = (
  e: unknown,
  resourceType: 'COLOR' | 'TRAIT',
  name: string | undefined,
  operation: string
): OperationResult<never, AdminDuplicateResourceNameError | DatabaseError> =>
  isP2002(e)
    ? failure(dupNameError(resourceType, name))
    : databaseFailure(operation, e);
