/**
 * Unit test — admin email-preview operation.
 *
 * WHAT THIS PROTECTS
 * ──────────────────
 * The preview tool renders EVERY previewable template (kernel catalog) via the
 * production `renderEmailTemplate`. This pins the catalog ↔ renderer contract:
 *  - every catalog id maps to a real BODY_TEMPLATES generator (render succeeds),
 *  - every subjectKey resolves to a real SUBJECTS entry (non-empty subject) —
 *    the tripwire for subjectKey drift when the schedule config changes,
 *  - sample vars cover the placeholder union (no unresolved {{…}} leaks),
 *  - input validation rejects unknown template / unsupported locale.
 */

import { describe, it, expect } from 'vitest';
import {
  EMAIL_PREVIEW_TEMPLATES,
  getEmailPreviewSpec,
} from '@kernel/domain/email/email-preview.catalog';
import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
import { adminGetEmailPreview_IO } from './email-preview.operation';

describe('adminGetEmailPreview_IO', () => {
  it('renders every catalog template in every locale (subject + html + text non-empty, no stray placeholders)', async () => {
    for (const spec of EMAIL_PREVIEW_TEMPLATES) {
      for (const locale of I18N_CONFIG.locales) {
        const result = await adminGetEmailPreview_IO({
          body: { templateId: spec.id, locale },
        });
        expect(result.success, `${spec.id}/${locale} should render`).toBe(true);
        if (result.success) {
          expect(
            result.data.subject.trim().length,
            `${spec.id}/${locale} subject empty → wrong/missing subjectKey`
          ).toBeGreaterThan(0);
          expect(result.data.html.length).toBeGreaterThan(0);
          expect(result.data.text.trim().length).toBeGreaterThan(0);
          expect(
            result.data.html,
            `${spec.id}/${locale} has an unresolved {{placeholder}}`
          ).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/);
        }
      }
    }
  });

  it('resolves a spec for every catalog id', () => {
    for (const spec of EMAIL_PREVIEW_TEMPLATES) {
      expect(getEmailPreviewSpec(spec.id)).not.toBeNull();
    }
  });

  it('rejects an unknown templateId', async () => {
    const result = await adminGetEmailPreview_IO({
      body: { templateId: 'not-a-real-template', locale: 'pl' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported locale', async () => {
    const result = await adminGetEmailPreview_IO({
      body: { templateId: 'welcome', locale: 'xx' },
    });
    expect(result.success).toBe(false);
  });
});
