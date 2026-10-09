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
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import type {
  AdminGetEmailPreviewRequest,
  AdminGetEmailPreviewResponse,
} from '@kernel/models/admin/admin.dto';
import { getEmailPreviewSpec } from '@kernel/domain/email/email-preview.catalog';
import { renderEmailTemplate } from './email-template.renderer';
import { BASE_SAMPLE_VARS } from './email-preview.samples';

// Sample unsubscribe URL so the footer renders a realistic (dead) link — the
// preview never sends, so no real token is minted.
const SAMPLE_UNSUBSCRIBE_URL = `${BRAND_CONFIG.url}/api/v1/email/unsubscribe?token=SAMPLE-TOKEN`;

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
    { ...BASE_SAMPLE_VARS },
    body.locale,
    SAMPLE_UNSUBSCRIBE_URL,
    spec.subjectKey
  );

  return success({
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
};
