import type { NextApiHandler } from 'next';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { withTimingNextHandlerMiddleware } from '@app/http/timing.middleware';
import {
  respondCreated,
  respondMethodNotAllowed,
  respondSuccess,
} from '@app/http/http.responses.utils';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireSalonStaffEnabled } from '@app/feature-flags/feature-flags.guard';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { HTTPRequestHandlerMiddleware } from '@app/http/request.middleware';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import type { SALON_STAFF_DTO_API_V1 } from '@kernel/models/salon-staff/salon-staff.dto';
import { getAllStaffMembers_IO } from '@domain/salon-staff/operations/salon-staff-query.operations';
import { inviteStaffMember_IO } from '@domain/salon-staff/operations/salon-staff-management.operations';
import { sendStaffInvitationNotification } from '@domain/salon-staff/salon-staff-invite-notification.service';
import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireAuthenticatedContext } from '@domain/user/user.types';

const handler: NextApiHandler = async (req, res) => {
  if (req.method === 'GET' || req.method === 'OPTIONS') {
    await HTTPRequestHandlerMiddleware<
      SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_ALL']['REQUEST']
    >(req, res, {
      eventName: APP_EVENTS.QUERIES.SALON_STAFF.SALON_STAFF_GET_ALL,
      contestedHTTPMethod: 'get',
      validationFunction: () => ({ __isValid: true }),
      businessLogic: async (_body, ctx) => {
        const { currentUser } = requireAuthenticatedContext(ctx);
        const accountCheck = requireStylistAccount(currentUser);
        if (!accountCheck.success) {
          return mapErrorToResponse(res, accountCheck.error);
        }

        // SALON_STAFF_ENABLED back-guard (after RBAC, before operation). 404 when
        // feature is killed — prevents IDOR bypass of the front route gate.
        if (!(await requireSalonStaffEnabled(res))) {
          return;
        }

        const result = await getAllStaffMembers_IO({
          accountId: accountCheck.data.account_id,
          pricingPlan: accountCheck.data.pricing_plan,
        });
        if (!result.success) {
          return mapErrorToResponse(res, result.error);
        }

        respondSuccess(
          res,
          result.data,
          APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_FETCHED
        );
      },
    });
    return;
  }

  if (req.method === 'POST') {
    await HTTPRequestHandlerMiddleware<
      SALON_STAFF_DTO_API_V1['SALON_STAFF_INVITE']['REQUEST']
    >(req, res, {
      eventName: APP_EVENTS.COMMANDS.SALON_STAFF.SALON_STAFF_INVITE,
      contestedHTTPMethod: 'post',
      validationFunction: VALIDATION_POLICY.validators.salonStaffInvite,
      businessLogic: async (body, ctx, metadata) => {
        const { currentUser } = requireAuthenticatedContext(ctx);
        const { email, role } = body;

        const accountCheck = requireStylistAccount(currentUser);
        if (!accountCheck.success) {
          return mapErrorToResponse(res, accountCheck.error);
        }

        // SALON_STAFF_ENABLED back-guard (after RBAC, before operation). 404 when
        // feature is killed — prevents IDOR bypass of the front route gate.
        if (!(await requireSalonStaffEnabled(res))) {
          return;
        }

        const result = await inviteStaffMember_IO({
          email,
          role,
          accountId: accountCheck.data.account_id,
          pricingPlan: accountCheck.data.pricing_plan,
        });
        if (!result.success) {
          return mapErrorToResponse(res, result.error);
        }

        // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
        // PII redaction: invitee email is OMITTED from audit payload (GDPR data
        // minimization) — only role is retained. Actor user_id is captured by
        // recordAuditEvent_IO via the `user` arg (separate column).
        runAfterResponse(() =>
          recordAuditEvent_IO({
            eventName: APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITED,
            user: currentUser,
            requestBody: redactAuditPayload(body, ['role']),
            metadata,
          })
        );
        // Invitee mail „X zaprasza Cię do zespołu salonu” (activity mail, gated on
        // her notifications_enabled inside the service; best-effort, never throws).
        runAfterResponse(() =>
          sendStaffInvitationNotification({
            staffMemberId: result.data.staff.id,
          })
        );

        respondCreated(
          res,
          result.data,
          APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITED
        );
      },
    });
    return;
  }

  // Fallthrough: neither an accepted GET/OPTIONS (query) nor POST (invite) — the
  // route exists but the verb is unsupported. 405 Method Not Allowed is the
  // RFC-correct status (was 400, which conflated "wrong verb" with "bad payload"
  // for an accepted verb). Event reuses ACCESS_DENIED_INFO (no dedicated
  // METHOD_NOT_ALLOWED kernel event; mirrors exchange-code's method-gate) — the
  // 405 status carries the semantic, the envelope just needs a valid INFO event.
  respondMethodNotAllowed(
    res,
    APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO,
    undefined
  );
};

export default withTimingNextHandlerMiddleware(handler);
