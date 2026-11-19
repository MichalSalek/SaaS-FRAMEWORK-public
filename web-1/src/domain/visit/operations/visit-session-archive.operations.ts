import { DB_CLIENT } from '@app/db/db.client';
import { isP2002 } from '@app/db/prisma-error';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import {
  SessionContainerLifecycleStateValue,
  VisitRecordSourceValue,
} from '@kernel/models/db_models.generated.dto';

export const createVisitRecordFromClosedSession_IO = async ({
  session_id,
}: {
  session_id: string;
}): Promise<OperationResult<{ created: boolean }, DatabaseError>> => {
  try {
    const session = await DB_CLIENT.use.sessionContainer.findUnique({
      where: { id: session_id },
      select: {
        id: true,
        lifecycle_state: true,
        shared_at: true,
        closed_at: true,
        stylist_account_id: true,
        client_account: { select: { created_by_user_id: true } },
      },
    });

    if (
      !session ||
      session.lifecycle_state !== SessionContainerLifecycleStateValue.CLOSED ||
      session.shared_at === null ||
      session.stylist_account_id === null
    ) {
      return success({ created: false });
    }

    // DECISION: the per-pair visit ceiling applies to BOTH insert paths, not only the manual one.
    // createManualVisit_IO enforced MAX_VISITS_PER_PAIR while this automatic path enforced nothing, so the
    // barrier against a loop (a buggy client/script closing sessions) could be bypassed sideways. Counted
    // WITHOUT a lock and without a transaction, on purpose: this operation is also called when a pair is
    // being torn down (`revokePairingAccess_IO`), when the active pair no longer exists, so the pair row
    // lock that serializes the manual path is unavailable. The cap is therefore soft (parallel archivals
    // may exceed it by a few rows), which suffices: it is a barrier against an endless loop, not a product
    // regulator, and duplicates of one session are cut by @@unique(session_id) (P2002 branch below).
    const visitCount = await DB_CLIENT.use.visitRecord.count({
      where: {
        client_user_id: session.client_account.created_by_user_id,
        stylist_account_id: session.stylist_account_id,
      },
    });
    if (visitCount >= VISIT_CONFIG.MAX_VISITS_PER_PAIR) {
      // A silent `created:false` would hide that the client's history stopped growing. The path is
      // best-effort, so session close is not blocked, but a trace is left: hitting the cap is a signal
      // to rethink the model (archiving old visits), not a normal state.
      reportIssueBackend({
        namespace: 'session-visit-archive',
        message: `Visit cap reached for pair — closed session not archived: ${session_id}`,
        payload: {
          visitCount,
          limit: VISIT_CONFIG.MAX_VISITS_PER_PAIR,
          stylistAccountId: session.stylist_account_id,
        },
        mode: 'warn',
      });
      return success({ created: false });
    }

    await DB_CLIENT.use.visitRecord.create({
      data: {
        client_user_id: session.client_account.created_by_user_id,
        stylist_account_id: session.stylist_account_id,
        visit_date: session.closed_at ?? new Date(),
        source: VisitRecordSourceValue.SESSION,
        session_id: session.id,
      },
    });

    return success({ created: true });
  } catch (error) {
    if (isP2002(error)) {
      return success({ created: false });
    }
    return databaseFailure('createVisitRecordFromClosedSession_IO', error);
  }
};

export const scheduleSessionVisitArchiveBestEffort = ({
  session_id,
}: {
  session_id: string;
}): void => {
  // DECISION: `runAfterResponse`, not a bare floating promise. A bare `void` lives outside the effect
  // registry, so graceful shutdown (every redeploy) does not wait for it: a session closed just before a
  // restart lost its visit record and nothing detected it, because the operation is best-effort and silent
  // by design. The wrapper slows nothing (the effect runs after the response anyway) but joins it to the
  // drain at process shutdown.
  runAfterResponse(() =>
    createVisitRecordFromClosedSession_IO({ session_id })
      .then(result => {
        if (!result.success) {
          reportIssueBackend({
            namespace: 'session-visit-archive',
            message: `Could not archive closed session as visit: ${session_id}`,
            payload: { errorType: result.error.type },
            mode: 'warn',
          });
        }
      })
      .catch(error => {
        reportIssueBackend({
          namespace: 'session-visit-archive',
          message: `Unexpected archive failure for closed session: ${session_id}`,
          // A raw Error serializes to {} (message/stack are non-enumerable), leaving the telemetry
          // payload empty; the message is extracted explicitly, like the .then branch.
          payload: {
            error: error instanceof Error ? error.message : String(error),
          },
          mode: 'warn',
        });
      })
  );
};
