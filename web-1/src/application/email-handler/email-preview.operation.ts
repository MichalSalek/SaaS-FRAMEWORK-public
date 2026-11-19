/**
 * Admin email-preview operation.
 *
 * Renders any outgoing template with sample data for the admin "Podgląd maili"
 * tool. Read-only + pure (no DB, no send) — the RBAC middleware already gates
 * this to MASTER_ADMIN (ADMIN_GET_EMAIL_PREVIEW is not in any role set → wildcard
 * admin-only), so the operation itself only validates inputs and renders.
 */

import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { ValidationError } from '@kernel/application/common-errors.types';
import { isValidLocale } from '@kernel/domain/i18n/i18n.config';
import type {
  AdminGetEmailPreviewRequest,
  AdminGetEmailPreviewResponse,
} from '@kernel/models/admin/admin.dto';
import { getEmailPreviewSpec } from '@kernel/domain/email/email-preview.catalog';
import {
  getEmailPreheader,
  renderEmailTemplate,
} from './email-template.renderer';
import {
  getSampleEmailVars,
  getSampleUnsubscribeUrl,
} from './email-preview.samples';
import { getEmailIdentity } from './email-identity';

export const adminGetEmailPreview_IO = async ({
  body,
}: {
  body: AdminGetEmailPreviewRequest;
}): Promise<OperationResult<AdminGetEmailPreviewResponse, ValidationError>> => {
  const spec = getEmailPreviewSpec(body.templateId);
  if (spec == null) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'templateId',
      message: `Unknown email template: ${body.templateId}`,
    });
  }

  if (!isValidLocale(body.locale)) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'locale',
      message: `Unsupported locale: ${body.locale}`,
    });
  }

  const rendered = renderEmailTemplate(
    spec.id,
    getSampleEmailVars(spec.id, body.locale),
    body.locale,
    getSampleUnsubscribeUrl(spec.id),
    spec.subjectKey
  );

  return success({
    ...getEmailIdentity(),
    preheader: getEmailPreheader(rendered.html),
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
};
