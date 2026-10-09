import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import {
  respondConflict,
  respondSuccess,
} from '@app/http/http.responses.utils';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminChangeThreadStatus_IO } from '@domain/support/operations/support-admin.operations';
import type { SUPPORT_DTO_API_V1 } from '@kernel/models/support/support.dto';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  SUPPORT_DTO_API_V1['SUPPORT_CHANGE_STATUS']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_CHANGE_STATUS']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.SUPPORT.SUPPORT_CHANGE_STATUS,
  method: 'post',
  validate: VALIDATION_POLICY.validators.changeSupportStatus,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminChangeThreadStatus_IO({
      threadId: body.thread_id,
      status: body.status,
      currentUser,
      // Optimistic-concurrency token (finding support-1). Optional — when the admin
      // UI sends the thread updated_at it last saw, a stale close is rejected (409).
      // Pass-through verbatim: absent/undefined LUB JSON null => unconditional change.
      // null jest normalizowany do "unconditional" w applySupportStatusWrite (finding
      // support-l2-2); validator (shared-kernel) celowo przepuszcza null jako "absent".
      expectedUpdatedAt: body.expected_updated_at,
    });

    if (!result.success) {
      // DECISION (nie usuwaj tego komentarza) — finding support-1 (USER-FIRST residual):
      // SUPPORT_THREAD_STALE jest na razie błędem LOKALNYM operacji (nie w kernelowej unii
      // SupportError / DomainError — patrz support-admin.operations.ts). Mapujemy go TUTAJ
      // wprost na 409 Conflict i robimy early-return, dzięki czemu discriminated-union
      // narrowing usuwa ten wariant z typu przekazywanego do mapErrorToResponse — centralny
      // exhaustive switch kompiluje się bez zmian. ALREADY_PROCESSED = najbliższe istniejące
      // INFO-event ("wątek zmienił się od Twojego widoku, pobierz ponownie i zdecyduj").
      // Gdy kernel wchłonie ten typ (dedykowany event + case w error-mapper), usuń ten blok
      // i pozwól mapErrorToResponse go obsłużyć.
      if (result.error.type === 'SUPPORT_THREAD_STALE') {
        return respondConflict(
          res,
          APP_EVENTS.INFO.APPLICATION.ALREADY_PROCESSED,
          { thread_id: body.thread_id }
        );
      }
      return mapErrorToResponse(res, result.error);
    }

    // support-2: no-op transition (status docelowy == biezacy) NIE generuje audit-event
    // (EventLog) ani DB-write (oba pominiete w applySupportStatusWrite). Bez tego guardu
    // re-CLOSE/re-OPEN sypal redundantny SUPPORT_STATUS_CHANGED do EventLog mimo zerowej
    // zmiany. result.data.noop niesie sygnal z operacji. Response zostaje 200 idempotent.
    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    if (!result.data.noop) {
      runAfterResponse(() =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.SUPPORT.SUPPORT_STATUS_CHANGED,
          user: { id: currentUser.id },
          requestBody: { thread_id: body.thread_id, status: body.status },
          metadata,
        })
      );
    }

    respondSuccess(
      res,
      { thread_id: result.data.thread_id, status: result.data.status },
      APP_EVENTS.INFO.SUPPORT.SUPPORT_STATUS_CHANGED
    );
  },
});
