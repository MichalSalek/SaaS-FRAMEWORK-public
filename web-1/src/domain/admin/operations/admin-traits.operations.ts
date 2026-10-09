import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { Trait } from '@kernel/models/db_models.generated.dto';
import type { TraitCategory } from '@kernel/models/db_models.manual.dto';
import {
  assertType,
  isTraitCategoryNarrower,
} from '@kernel/models/type_narrowing';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isP2025 } from '@app/db/prisma-error';
import {
  pickTraitUpdateFields,
  traitNameConflict,
  dbOrDupFailure,
} from './admin-colors-traits.update-fields.helper';
import { emitTaxonomyAudit } from './admin-colors-traits.audit.helper';
import type { ColorTraitError } from './admin-colors-traits.shared';
import { normalizeName, withTrimmedName } from './admin-colors-traits.shared';

const narrowTrait = <T extends { category: string }>(t: T) => ({
  ...t,
  category: assertType(t.category, isTraitCategoryNarrower, 'Trait.category'),
});

export const createTrait_IO = async ({
  data,
  currentUser,
}: {
  data: {
    name: string;
    category: TraitCategory;
    icon_url?: string;
    display_order?: number;
    is_featured?: boolean;
  };
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<Trait, ColorTraitError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }
  try {
    const conflict = await traitNameConflict(data.name);
    if (conflict) {
      return failure(conflict);
    }
    const trait = await DB_CLIENT.use.trait.create({
      data: {
        name: normalizeName(data.name),
        category: data.category,
        icon_url: data.icon_url ?? null,
        display_order: data.display_order ?? 0,
        is_featured: data.is_featured ?? false,
      },
    });
    reportIssueBackend({
      namespace: 'ADMIN_TRAIT',
      message: `Trait created: ${trait.name}`,
      payload: { trait_id: trait.id },
      mode: 'info',
    });
    await emitTaxonomyAudit(
      currentUser.id,
      APP_EVENTS.INFO.ADMIN.TRAIT_CREATED,
      {
        trait_id: trait.id,
        name: trait.name,
        category: trait.category,
        is_featured: trait.is_featured,
      }
    );
    return success(narrowTrait(trait));
  } catch (e) {
    return dbOrDupFailure(e, 'TRAIT', data.name, 'createTrait');
  }
};

export const updateTrait_IO = async ({
  data,
  currentUser,
}: {
  data: {
    trait_id: string;
    name?: string;
    category?: TraitCategory;
    icon_url?: string;
    display_order?: number;
    is_active?: boolean;
    is_featured?: boolean;
  };
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<Trait, ColorTraitError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  const { trait_id } = data;
  const updateData = pickTraitUpdateFields(withTrimmedName(data));

  try {
    const existing = await DB_CLIENT.use.trait.findUnique({
      where: { id: trait_id },
    });
    if (!existing) {
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: trait_id,
        targetType: 'RECORD',
      });
    }

    const conflict = await traitNameConflict(data.name, trait_id);
    if (conflict) {
      return failure(conflict);
    }
    const trait = await DB_CLIENT.use.trait.update({
      where: { id: trait_id },
      data: updateData,
    });
    reportIssueBackend({
      namespace: 'ADMIN_TRAIT',
      message: `Trait updated: ${trait.id}`,
      payload: { trait_id: trait.id },
      mode: 'info',
    });
    await emitTaxonomyAudit(
      currentUser.id,
      APP_EVENTS.INFO.ADMIN.TRAIT_UPDATED,
      {
        trait_id: trait.id,
        before: {
          name: existing.name,
          category: existing.category,
          display_order: existing.display_order,
          is_active: existing.is_active,
          is_featured: existing.is_featured,
        },
        after: {
          name: trait.name,
          category: trait.category,
          display_order: trait.display_order,
          is_active: trait.is_active,
          is_featured: trait.is_featured,
        },
      }
    );
    return success(narrowTrait(trait));
  } catch (e) {
    // P2025 = "record to update not found": the trait existed at the findUnique
    // pre-check but a concurrent delete removed it before this update. Surface the
    // idempotent 404 (parity with updatePolicy_IO / updateColor_IO) instead of a
    // misleading 500. dbOrDupFailure never throws P2025 (create can't).
    if (isP2025(e)) {
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: trait_id,
        targetType: 'RECORD',
      });
    }
    return dbOrDupFailure(e, 'TRAIT', data.name, 'updateTrait');
  }
};

export const deleteTrait_IO = async ({
  data,
  currentUser,
}: {
  data: {
    trait_id: string;
  };
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<void, ColorTraitError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    const txResult = await DB_CLIENT.use.$transaction(async tx => {
      // `name` selected (not just id) so the deleted resource is identifiable in the
      // durable audit row — the EventLog FK points at the actor, not the deleted record.
      const existing = await tx.trait.findUnique({
        where: { id: data.trait_id },
        select: { id: true, name: true },
      });
      if (!existing) {
        return { ok: false as const, error: 'NOT_FOUND' as const };
      }

      const refCount = await tx.galleryRecordTrait.count({
        where: { trait_id: data.trait_id },
      });
      if (refCount > 0) {
        return {
          ok: false as const,
          error: 'HAS_REFERENCES' as const,
          refCount,
        };
      }

      await tx.trait.delete({ where: { id: data.trait_id } });
      return { ok: true as const, name: existing.name };
    });

    if (!txResult.ok) {
      if (txResult.error === 'NOT_FOUND') {
        return failure({
          type: 'ADMIN_TARGET_NOT_FOUND',
          targetId: data.trait_id,
          targetType: 'RECORD',
        });
      }
      return failure({
        type: 'ADMIN_RESOURCE_HAS_REFERENCES',
        resourceId: data.trait_id,
        resourceType: 'TRAIT',
        referenceCount: txResult.refCount,
      });
    }

    reportIssueBackend({
      namespace: 'ADMIN_TRAIT',
      message: `Trait deleted: ${data.trait_id}`,
      payload: { trait_id: data.trait_id },
      mode: 'info',
    });
    await emitTaxonomyAudit(
      currentUser.id,
      APP_EVENTS.INFO.ADMIN.TRAIT_DELETED,
      {
        trait_id: data.trait_id,
        name: txResult.name,
      }
    );
    return success(undefined);
  } catch (e) {
    // P2025 = concurrent double-delete race: the tx pre-check saw the trait but it
    // was deleted before tx.trait.delete ran. Surface the idempotent "already gone"
    // 404 (parity with deletePolicy_IO / deleteColor_IO) instead of a 500.
    if (isP2025(e)) {
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: data.trait_id,
        targetType: 'RECORD',
      });
    }
    return databaseFailure('deleteTrait', e);
  }
};
