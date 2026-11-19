import { describe, expect, it } from 'vitest';
import { EMAIL_PREVIEW_TEMPLATES } from '@kernel/domain/email/email-preview.catalog';
import { renderEmailTemplate } from './email-template.renderer';
import { BASE_SAMPLE_VARS } from './email-preview.samples';
import { getEmailIdentity } from './email-identity';

describe('shared customer email system', () => {
  it('puts inbox preview first and provides monitored replies on every template and locale', () => {
    for (const template of EMAIL_PREVIEW_TEMPLATES) {
      for (const locale of ['pl', 'en', 'de'] as const) {
        const result = renderEmailTemplate(
          template.id,
          BASE_SAMPLE_VARS,
          locale,
          '',
          template.subjectKey
        );
        const context = `${template.id}/${locale}`;
        expect(result.html, context).toContain(
          `data-email-template="${template.id}"`
        );
        expect(
          result.html.indexOf('data-email-preheader="1"'),
          context
        ).toBeLessThan(result.html.indexOf('class="email-ground"'));
        expect(result.html, context).toContain('mailto:support@example.com');
        expect(result.html, context).toMatch(/\/img\/email\/v2\/[a-z]+\.png/);
        expect(result.html, context).not.toMatch(/\{\{|noreply@|no-reply@/);
        expect(result.subject.trim(), context).not.toBe('');
        expect(result.html, context).toContain('Ekipa Nailfolio!');
        expect(result.subject + result.html + result.text, context).not.toMatch(
          /Micha[lł]/i
        );
        expect(result.text, context).toContain('support@example.com');
        expect(getEmailIdentity().from, context).toContain(
          '<contact@example.com>'
        );
      }
    }
  });

  it('clarifies that email replies reach help, while conversations stay in the app', () => {
    const result = renderEmailTemplate(
      'messaging-notification',
      BASE_SAMPLE_VARS,
      'pl',
      '',
      'email.messagingNotification.subject'
    );
    expect(result.text).toContain('pomocy Nailfolio');
    expect(result.text).toContain('aplikacji');
  });

  it('escapes personal data without breaking real links', () => {
    const result = renderEmailTemplate(
      'welcome',
      { ...BASE_SAMPLE_VARS, displayName: '<script>alert(1)</script>' },
      'pl',
      '',
      'email.welcome.subject'
    );
    expect(result.html).not.toContain('<script>');
    expect(result.text).toContain('https://');
    expect(result.text).not.toContain('data-email-preheader');
  });
});
