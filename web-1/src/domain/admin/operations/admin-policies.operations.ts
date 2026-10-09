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

// DECISION (nie usuwaj tego komentarza):
// admin-notes-policies-1 (race "exactly one main policy") — bounded retry count for
// the Serializable set-main transaction. Postgres SSI aborts the loser of two
// concurrent set-main calls with SQLSTATE 40001 (isSerializationConflict); we retry
// it in-place rather than surfacing a 500 — the legal "active policy" switch is an
// idempotent admin write, so a transparent retry (loser re-reads the now-committed
// is_main=true and clears it before setting its own) yields exactly one main with
// NO error returned to the operator. 3 attempts is ample: under realistic admin
// concurrency the conflict window is single-digit ms and one retry already
// linearizes; the bound just prevents an unbounded spin under pathological churn,
// after which the conflict propagates to the existing catch (databaseFailure → 500).
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
    ADMIN_DTO_API_V1['ADMIN_GET_POLICIES']['RESPONSE'],
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

      // DECISION (nie usuwaj tego komentarza):
      // D4 — Admin config audit. Policy = legal content (regulamin, privacy policy,
      // ToS). Each edit must trace to admin actor + show diff. before_title/content
      // ułatwia compliance review po zmianie warunków świadczenia usług.
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

    // DECISION (nie usuwaj tego komentarza):
    // D4 — Create path: no before_value (resource didn't exist). Capture full
    // after_value for first-write audit. Content length tracked instead of full
    // content (avoid bloating EventLog payload — full content readable via Policy table).
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
    // (TOCTOU window). Surface a 404 — same semantics as an up-front non-existent id
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

    // DECISION (nie usuwaj tego komentarza):
    // The main policy is the currently-active legal document shown to users (ToS /
    // privacy). Deleting it without first promoting another would leave zero policies
    // with is_main=true, breaking any frontend logic that reads the "active" policy.
    // Dedicated error ADMIN_POLICY_IS_MAIN_CANNOT_DELETE (mapped to 400 Bad Request)
    // — NOT a stand-in for ADMIN_TARGET_PROTECTED (which is the self/cross-admin actor
    // guard). Blokada (nie auto-promote) wystarczy na pre-launch: admin MUSI świadomie
    // wywołać setMainPolicy na inny rekord zanim skasuje obecny main.
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

    // DECISION (nie usuwaj tego komentarza):
    // D4 — Delete is destructive. Capture before_value (title + is_main) to enable
    // post-mortem if wrong policy was deleted. content_length zostaje as audit
    // breadcrumb (rekonstruowalne z snapshot/backup jeśli potrzebne).
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
    // check above but a concurrent delete committed first (double-delete race) — the
    // delete is not idempotent. Surface a 404 ("already gone") instead of a generic
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

    // DECISION (nie usuwaj tego komentarza):
    // admin-notes-policies-1 (race "exactly one main policy", F4 atomicity) — the
    // "exactly one is_main=true" invariant is enforced PURELY in application code
    // (clear-all → set-one); the schema has @@index([is_main]) but NO @@unique, so
    // storage gives no backstop. The array form $transaction([updateMany, update])
    // is atomic but runs at READ COMMITTED: two concurrent set-main calls for
    // DIFFERENT ids each see "neither is main" at statement start, so each updateMany
    // is a no-op against the other, and BOTH set their own row true → two mains
    // (downstream wedge: deletePolicy_IO then blocks deleting either via
    // ADMIN_POLICY_IS_MAIN_CANNOT_DELETE). Fix = { isolationLevel: 'Serializable' }
    // (Postgres SSI aborts the loser with 40001) + in-place retry: on retry the loser
    // observes the committed is_main=true and clears it before setting its own, so the
    // invariant holds under any concurrency. Mirrors impersonation-backup.utils.ts
    // (Serializable + isSerializationConflict) for the same concurrent-writer class.
    // We use the INTERACTIVE tx form (callback) so the abort surfaces to our retry
    // catch; the array form would not let us distinguish a conflict for retry.
    // The previousMain read sits INSIDE the callback (before updateMany) so it joins
    // the SSI predicate-lock set: a concurrent set-main on a different id can't make it
    // stale, and on retry the loser re-reads the now-committed is_main row, so the
    // POLICY_SET_MAIN audit always records the true pre-switch main.
    // KROK 3b: bounded Serializable retry skonsolidowany do withWriteTx (@app/db/with-write-tx).
    // retryOn ZAWEZONY do isSerializationConflict (Serializable SSI 40001 — NIE deadlock; default
    // isConcurrencyConflict bylby szerszy niz intencja). backoffMs:()=>0 = immediate retry (parytet
    // ze starym recznym `continue` bez sleepu; SSI loser re-czyta scommitowany is_main natychmiast).
    // maxAttempts = SET_MAIN_POLICY_MAX_ATTEMPTS. Non-retryable (P2025 target-deleted mid-flight) ORAZ
    // exhausted-conflict sa RETHROWANE przez withWriteTx -> outer catch mapuje P2025 -> 404, reszta ->
    // databaseFailure (500). Exhausted-conflict jako 500 = akceptowalny residual (inwariant "dokladnie
    // jeden main" nigdy zlamany; tylko ekstremalny churn-loser pada glosno zamiast spinowac).
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

    // DECISION (nie usuwaj tego komentarza):
    // D4 — Main policy switch = legal "which doc applies right now" change.
    // previous_main_id pozwala odtworzyć poprzedni stan jeśli switch był pomyłką.
    // Brak previousMain (null) = pierwsze ustawienie main policy.
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
    // update ran (TOCTOU window). Surface a 404 instead of a generic 500. Only the
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
