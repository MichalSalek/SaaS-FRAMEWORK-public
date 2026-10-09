import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { Color } from '@kernel/models/db_models.generated.dto';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isP2025 } from '@app/db/prisma-error';
import {
  pickColorUpdateFields,
  colorNameConflict,
  dbOrDupFailure,
} from './admin-colors-traits.update-fields.helper';
import { emitTaxonomyAudit } from './admin-colors-traits.audit.helper';
import type { ColorTraitError } from './admin-colors-traits.shared';
import { normalizeName, withTrimmedName } from './admin-colors-traits.shared';

export const createColor_IO = async ({
  data,
  currentUser,
}: {
  data: {
    name: string;
    hex_code: string;
    display_order?: number;
  };
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<Color, ColorTraitError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }
  try {
    const conflict = await colorNameConflict(data.name);
    if (conflict) {
      return failure(conflict);
    }
    const color = await DB_CLIENT.use.color.create({
      data: {
        name: normalizeName(data.name),
        hex_code: data.hex_code,
        display_order: data.display_order ?? 0,
      },
    });
    reportIssueBackend({
      namespace: 'ADMIN_COLOR',
      message: `Color created: ${color.name}`,
      payload: { color_id: color.id },
      mode: 'info',
    });
    await emitTaxonomyAudit(
      currentUser.id,
      APP_EVENTS.INFO.ADMIN.COLOR_CREATED,
      {
        color_id: color.id,
        name: color.name,
        hex_code: color.hex_code,
      }
    );
    return success(color);
  } catch (e) {
    return dbOrDupFailure(e, 'COLOR', data.name, 'createColor');
  }
};

export const updateColor_IO = async ({
  data,
  currentUser,
}: {
  data: {
    color_id: string;
    name?: string;
    hex_code?: string;
    display_order?: number;
    is_active?: boolean;
  };
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<Color, ColorTraitError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  const { color_id } = data;
  const updateData = pickColorUpdateFields(withTrimmedName(data));

  try {
    const existing = await DB_CLIENT.use.color.findUnique({
      where: { id: color_id },
    });
    if (!existing) {
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: color_id,
        targetType: 'RECORD',
      });
    }

    const conflict = await colorNameConflict(data.name, color_id);
    if (conflict) {
      return failure(conflict);
    }
    const color = await DB_CLIENT.use.color.update({
      where: { id: color_id },
      data: updateData,
    });
    reportIssueBackend({
      namespace: 'ADMIN_COLOR',
      message: `Color updated: ${color.id}`,
      payload: { color_id: color.id },
      mode: 'info',
    });
    await emitTaxonomyAudit(
      currentUser.id,
      APP_EVENTS.INFO.ADMIN.COLOR_UPDATED,
      {
        color_id: color.id,
        before: {
          name: existing.name,
          hex_code: existing.hex_code,
          display_order: existing.display_order,
          is_active: existing.is_active,
        },
        after: {
          name: color.name,
          hex_code: color.hex_code,
          display_order: color.display_order,
          is_active: color.is_active,
        },
      }
    );
    return success(color);
  } catch (e) {
    // P2025 = "record to update not found": the color existed at the findUnique
    // pre-check above but a concurrent delete removed it before this update.
    // Surface the idempotent 404 (parity with updatePolicy_IO / the P2025→NOT_FOUND
    // convention) instead of a misleading 500. dbOrDupFailure never throws P2025
    // (create can't), so checking here is safe.
    if (isP2025(e)) {
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: color_id,
        targetType: 'RECORD',
      });
    }
    return dbOrDupFailure(e, 'COLOR', data.name, 'updateColor');
  }
};

export const deleteColor_IO = async ({
  data,
  currentUser,
}: {
  data: {
    color_id: string;
  };
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<void, ColorTraitError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  // existence check + reference count + delete in one transaction so a
  // concurrent gallery insert can't race past the count and orphan FKs.
  try {
    const txResult = await DB_CLIENT.use.$transaction(async tx => {
      // `name` selected (not just id) so the deleted resource is identifiable in the
      // durable audit row — the EventLog FK points at the actor, not the deleted record.
      const existing = await tx.color.findUnique({
        where: { id: data.color_id },
        select: { id: true, name: true },
      });
      if (!existing) {
        return { ok: false as const, error: 'NOT_FOUND' as const };
      }

      const refCount = await tx.galleryRecordColor.count({
        where: { color_id: data.color_id },
      });
      if (refCount > 0) {
        return {
          ok: false as const,
          error: 'HAS_REFERENCES' as const,
          refCount,
        };
      }

      await tx.color.delete({ where: { id: data.color_id } });
      return { ok: true as const, name: existing.name };
    });

    if (!txResult.ok) {
      if (txResult.error === 'NOT_FOUND') {
        return failure({
          type: 'ADMIN_TARGET_NOT_FOUND',
          targetId: data.color_id,
          targetType: 'RECORD',
        });
      }
      return failure({
        type: 'ADMIN_RESOURCE_HAS_REFERENCES',
        resourceId: data.color_id,
        resourceType: 'COLOR',
        referenceCount: txResult.refCount,
      });
    }

    reportIssueBackend({
      namespace: 'ADMIN_COLOR',
      message: `Color deleted: ${data.color_id}`,
      payload: { color_id: data.color_id },
      mode: 'info',
    });
    await emitTaxonomyAudit(
      currentUser.id,
      APP_EVENTS.INFO.ADMIN.COLOR_DELETED,
      {
        color_id: data.color_id,
        name: txResult.name,
      }
    );
    return success(undefined);
  } catch (e) {
    // P2025 = concurrent double-delete race: the tx pre-check saw the color but it
    // was deleted before tx.color.delete ran. Surface the idempotent "already gone"
    // 404 (parity with deletePolicy_IO) instead of a 500.
    if (isP2025(e)) {
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: data.color_id,
        targetType: 'RECORD',
      });
    }
    return databaseFailure('deleteColor', e);
  }
};
