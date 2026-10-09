import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { changePaidPlan_IO } from '@domain/account/operations/account-plan-change.operations';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineHandler<
  ACCOUNT_DTO_API_V1['ACCOUNT_PLAN_CHANGE']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_PLAN_CHANGE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_PLAN_CHANGE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.planChange,
  handle: async (body, ctx, metadata, res) => {
    // userId ZAWSZE z sesji, NIGDY z body.
    const { session } = requireAuthenticatedContext(ctx);
    const result = await changePaidPlan_IO({
      userId: session.userId,
      targetPlanId: body.targetPlanId,
      billingPeriod: body.billingPeriod,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // DECISION (nie usuwaj tego komentarza): audit PRICING_PLAN_CHANGED TYLKO dla
    // status==='completed'. Z 3-status contract (pending_if_incomplete) 'requires_action'
    // (plan NIE applied — czeka na 3DS) i 'payment_failed' (plan NIE zmieniony) NIE sa
    // "changed" — logowanie ich pod PRICING_PLAN_CHANGED klamaloby event-log. Realna zmiana
    // DB pricing_plan jest audytowana przez webhook (ADMIN_PRICING_PLAN_CHANGED w
    // plan-status-update.operations, gated na oldPricingPlan !== pricingPlan) = SSOT audytu zmiany.
    // UWAGA (cross-model review): failed/abandoned proby (requires_action/payment_failed) SWIADOMIE
    // NIE maja structured durable audit-trace pre-launch — command-event ACCOUNT_PLAN_CHANGE
    // (defineHandler) NIE jest persystowany (eventName sluzy permission/error-path, nie zapisowi),
    // a pending-state reportIssueBackend to mode:'info' (prod no-op). Stripe dashboard ma invoice/PI
    // trail; structured audit tych prob = post-launch jesli potrzebny (NIE over-build pre-launch).
    if (result.data.status === 'completed') {
      // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
      runAfterResponse(() =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.ACCOUNT.PRICING_PLAN_CHANGED,
          user: { id: session.userId },
          requestBody: {
            targetPlanId: body.targetPlanId,
            billingPeriod: body.billingPeriod,
            status: result.data.status,
          },
          metadata,
        })
      );
    }

    respondSuccess(res, result.data);
  },
});
