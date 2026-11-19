import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  AdminInsufficientPermissionsError,
  AdminTargetNotFoundError,
  AdminPolicyIsMainCannotDeleteError,
} from '@kernel/domain/admin/admin-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { isP2025 } from '@app/db/prisma-error';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isSerializationConflict } from '@app/db/serialization-conflict';
import { withWriteTx } from '@app/db/with-write-tx';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import type { ContractHandlerResponse } from '@kernel/application/contracts/contract.types';
import type { AdminContracts } from '@kernel/domain/admin/admin.contracts';

type AdminHandlerData<K extends keyof AdminContracts> = ContractHandlerResponse<
  AdminContracts[K]
>;

// DECISION: bounded retry for the Serializable set-main transaction.
// retryOn is isSerializationConflict (40001) only, up to
// SET_MAIN_POLICY_MAX_ATTEMPTS. An exhausted conflict is databaseFailure.
const SET_MAIN_POLICY_MAX_ATTEMPTS = 3;

type PoliciesError =
  | AdminInsufficientPermissionsError
  | AdminTargetNotFoundError
  | AdminPolicyIsMainCannotDeleteError
  | DatabaseError;

/**
 * Get all policies (ordered by isMain DESC, updated_at DESC)
 */
export const getPolicies_IO = async ({
  currentUser,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    AdminHandlerData<'ADMIN_GET_POLICIES'>,
    AdminInsufficientPermissionsError | DatabaseError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    const policies = await DB_CLIENT.use.policy.findMany({
      orderBy: [{ is_main: 'desc' }, { updated_at: 'desc' }],
      take: 100,
    });

    reportIssueBackend({
      namespace: 'getPolicies',
      message: `Fetched ${policies.length} policies`,
      payload: { count: policies.length },
      mode: 'info',
    });

    return success({ policies });
  } catch (error) {
    return databaseFailure('getPolicies', error);
  }
};

/**
 * Save (upsert) a policy.
 * If `id` is provided — update. Otherwise — create.
 */
export const savePolicy_IO = async ({
  data,
  currentUser,
}: {
  data: ADMIN_DTO_API_V1['ADMIN_SAVE_POLICY']['REQUEST'];
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<{ policy_id: string }, PoliciesError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    if (data.id) {
      // Update path — verify existence first to return AdminTargetNotFound
      const existing = await DB_CLIENT.use.policy.findUnique({
        where: { id: data.id },
      });
      if (!existing) {
        return failure({
          type: 'ADMIN_TARGET_NOT_FOUND',
          targetId: data.id,
          targetType: 'RECORD',
        });
      }
      const updated = await DB_CLIENT.use.policy.update({
        where: { id: data.id },
        data: { title: data.title, content: data.content },
      });
      reportIssueBackend({
        namespace: 'savePolicy',
        message: `Updated policy ${updated.id}`,
        payload: { policy_id: updated.id },
        mode: 'info',
      });

      // Policies are legal content: every edit is traced to the admin with a before/after summary.
      await writeRawEventLog_IO({
        eventName: APP_EVENTS.INFO.ADMIN.POLICY_SAVED,
        eventLogType: EventLogTypeValue.ADMIN,
        meta: {
          created_by_user_id: currentUser.id,
        },
        eventPayloadToStringify: {
          policy_id: updated.id,
          operation: 'update',
          before_title: existing.title,
          after_title: updated.title,
          before_content_length: existing.content.length,
          after_content_length: updated.content.length,
        },
      });
      return success({ policy_id: updated.id });
    }

    const created = await DB_CLIENT.use.policy.create({
      data: { title: data.title, content: data.content },
    });
    reportIssueBackend({
      namespace: 'savePolicy',
      message: `Created policy ${created.id}`,
      payload: { policy_id: created.id },
      mode: 'info',
    });

    // Content length, not full content, keeps the EventLog payload small (the text lives in Policy).
    await writeRawEventLog_IO({
      eventName: APP_EVENTS.INFO.ADMIN.POLICY_SAVED,
      eventLogType: EventLogTypeValue.ADMIN,
      meta: {
        created_by_user_id: currentUser.id,
      },
      eventPayloadToStringify: {
        policy_id: created.id,
        operation: 'create',
        after_title: created.title,
        after_content_length: created.content.length,
      },
    });
    return success({ policy_id: created.id });
  } catch (error) {
    // P2025 = "record to update not found": the policy existed at the findUnique
    // check above but was deleted by a concurrent request before policy.update ran
    // (between check and update). Return a 404, same semantics as an up-front non-existent id
    // — instead of a generic 500. Only reachable on the update path (data.id is
    // truthy there; create never throws P2025). Convention mirrors
    // admin-notes.operations.ts (setMainNote).
    if (isP2025(error)) {
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: data.id ?? '',
        targetType: 'RECORD',
      });
    }
    return databaseFailure('savePolicy', error);
  }
};

/**
 * Delete a policy by id.
 */
export const deletePolicy_IO = async ({
  data,
  currentUser,
}: {
  data: ADMIN_DTO_API_V1['ADMIN_DELETE_POLICY']['REQUEST'];
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<{ success: boolean }, PoliciesError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    const existing = await DB_CLIENT.use.policy.findUnique({
      where: { id: data.id },
    });
    if (!existing) {
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: data.id,
        targetType: 'RECORD',
      });
    }

    // DECISION: the main policy is the active legal document; deleting it would leave none with
    // is_main=true. Block (no auto-promote): the admin must set another main first. Own error
    // ADMIN_POLICY_IS_MAIN_CANNOT_DELETE (400), not ADMIN_TARGET_PROTECTED (the actor guard).
    if (existing.is_main) {
      return failure({
        type: 'ADMIN_POLICY_IS_MAIN_CANNOT_DELETE',
        policyId: data.id,
      });
    }

    await DB_CLIENT.use.policy.delete({ where: { id: data.id } });

    reportIssueBackend({
      namespace: 'deletePolicy',
      message: `Deleted policy ${data.id}`,
      payload: { policy_id: data.id },
      mode: 'info',
    });

    // Destructive: keep the before-state (title, is_main) for a post-mortem of a wrong delete.
    await writeRawEventLog_IO({
      eventName: APP_EVENTS.INFO.ADMIN.POLICY_DELETED,
      eventLogType: EventLogTypeValue.ADMIN,
      meta: {
        created_by_user_id: currentUser.id,
      },
      eventPayloadToStringify: {
        policy_id: data.id,
        before_title: existing.title,
        before_is_main: existing.is_main,
        before_content_length: existing.content.length,
      },
    });

    return success({ success: true });
  } catch (error) {
    // P2025 = "record to delete not found": the policy existed at the findUnique
    // check above but a concurrent delete committed first (double delete). Return a 404
    // ("already gone") instead of a generic
    // 500; this is otherwise-valid input, not a server fault. Convention mirrors
    // admin-notes.operations.ts (setMainNote).
    if (isP2025(error)) {
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: data.id,
        targetType: 'RECORD',
      });
    }
    return databaseFailure('deletePolicy', error);
  }
};

/**
 * Set a policy as main (transactional — unset all others, set this one).
 */
export const setMainPolicy_IO = async ({
  data,
  currentUser,
}: {
  data: ADMIN_DTO_API_V1['ADMIN_SET_MAIN_POLICY']['REQUEST'];
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<undefined, PoliciesError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    const existing = await DB_CLIENT.use.policy.findUnique({
      where: { id: data.id },
    });
    if (!existing) {
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: data.id,
        targetType: 'RECORD',
      });
    }

    // Captured INSIDE the Serializable tx below (before updateMany) so it reflects the
    // committed pre-write state under SSI — see the DECISION comment on the tx.
    let previousMain: { id: string; title: string } | null = null;

    // DECISION: set-main clears is_main, then sets this id, in a Serializable
    // transaction (retry on 40001 only). The schema has @@index([is_main]) and
    // no unique on is_main. The previousMain read sits inside the transaction.
    // Two concurrent set-main calls are not pinned by a test. An exhausted
    // conflict is databaseFailure, and 40001 is not a classified query failure,
    // so that path is an opaque 500. A rethrown P2025 maps to 404 below.
    previousMain = await withWriteTx(
      async tx => {
        const prior = await tx.policy.findFirst({
          where: { is_main: true },
          select: { id: true, title: true },
        });
        await tx.policy.updateMany({
          where: { is_main: true },
          data: { is_main: false },
        });
        await tx.policy.update({
          where: { id: data.id },
          data: { is_main: true },
        });
        return prior;
      },
      {
        isolationLevel: 'Serializable',
        retryOn: isSerializationConflict,
        backoffMs: () => 0,
        maxAttempts: SET_MAIN_POLICY_MAX_ATTEMPTS,
      }
    );

    // previous_main_id lets a mistaken switch be reverted; null means the first main ever set.
    await writeRawEventLog_IO({
      eventName: APP_EVENTS.INFO.ADMIN.POLICY_SET_MAIN,
      eventLogType: EventLogTypeValue.ADMIN,
      meta: {
        created_by_user_id: currentUser.id,
      },
      eventPayloadToStringify: {
        policy_id: data.id,
        new_main_title: existing.title,
        previous_main_id: previousMain?.id ?? null,
        previous_main_title: previousMain?.title ?? null,
      },
    });

    reportIssueBackend({
      namespace: 'setMainPolicy',
      message: `Set policy ${data.id} as main`,
      payload: { policy_id: data.id },
      mode: 'info',
    });

    return success(undefined);
  } catch (error) {
    // P2025 = "record to update not found": the policy existed at the findUnique
    // check above but was deleted by a concurrent request before the $transaction
    // update ran (between check and update). Return a 404 instead of a generic 500. Only the
    // policy.update on data.id can throw this — updateMany is a silent no-op on zero
    // matches. Convention mirrors admin-notes.operations.ts (setMainNote).
    if (isP2025(error)) {
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: data.id,
        targetType: 'RECORD',
      });
    }
    return databaseFailure('setMainPolicy', error);
  }
};
