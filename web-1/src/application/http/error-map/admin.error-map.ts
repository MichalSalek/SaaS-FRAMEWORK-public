// Admin errors (kernel `AdminError`).
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { AdminError } from '@kernel/domain/admin/admin-errors.types';
import {
  respondBadRequest,
  respondConflict,
  respondForbidden,
  respondNotFound,
} from '../http.responses.utils';
import type { ErrorResponderMap, OwnErrors } from './error-map.types';
import { respondOpaqueFailure } from './shared.responders';

export const adminErrorMap = {
  ADMIN_INSUFFICIENT_PERMISSIONS: (res, error) =>
    respondForbidden(res, {
      requiredRole: error.requiredRole,
      currentRole: error.currentRole,
    }),

  ADMIN_TARGET_NOT_FOUND: (res, error) =>
    respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, {
      targetId: error.targetId,
      targetType: error.targetType,
    }),

  // 403 with reason: an admin tried to act on herself or another admin. The reason is not
  // sensitive; the UI uses it to render a specific message.
  ADMIN_TARGET_PROTECTED: (res, error) =>
    respondForbidden(res, { reason: error.reason }),

  ADMIN_POLICY_IS_MAIN_CANNOT_DELETE: (res, error) =>
    // 400: an admin tried to delete the main (active) legal policy, which would leave no main
    // policy; another policy must be promoted first. policyId echoed for the UI.
    respondBadRequest(res, APP_EVENTS.INFO.ADMIN.CANNOT_DELETE_MAIN_POLICY, {
      policyId: error.policyId,
    }),

  ADMIN_RESOURCE_HAS_REFERENCES: (res, error) =>
    respondBadRequest(res, APP_EVENTS.INFO.ADMIN.RESOURCE_HAS_REFERENCES, {
      resourceId: error.resourceId,
      resourceType: error.resourceType,
      referenceCount: error.referenceCount,
    }),

  ADMIN_DUPLICATE_RESOURCE_NAME: (res, error) =>
    // 409: create/update hit a unique constraint (P2002) on the resource name. No dedicated INFO
    // event exists for admin name collisions; VALIDATION_FAILED is the closest semantic.
    // resourceType + name echoed so the UI can render "name already taken".
    respondConflict(res, APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED, {
      resourceType: error.resourceType,
      name: error.name,
    }),

  // 403: an attempt to edit a config-defined system role (MASTER_ADMIN wildcard). The write would
  // be a runtime no-op plus a misleading audit diff; rejected in admin-permissions.operations.ts.
  ADMIN_SYSTEM_ROLE_IMMUTABLE: (res, error) =>
    respondForbidden(res, { roleId: error.roleId }),

  IMPERSONATION_SENSITIVE_BLOCKED: (res, error) =>
    // 403: an admin impersonating a user attempted a sensitive mutation. The audit event is already
    // emitted at the gate (admin-impersonation.utils.ts → enforceImpersonationGate_IO).
    respondForbidden(
      res,
      {
        command: error.command,
        adminUserId: error.adminUserId,
        targetUserId: error.targetUserId,
      },
      APP_EVENTS.INFO.ADMIN.IMPERSONATION_SENSITIVE_BLOCKED
    ),

  CHECK_ACCESS_URL_FORBIDDEN: res => respondForbidden(res, undefined),

  // The reason is logged server-side, never leaked to the client.
  CHECK_ACCESS_URL_NETWORK: respondOpaqueFailure,
} satisfies ErrorResponderMap<OwnErrors<AdminError>>;
