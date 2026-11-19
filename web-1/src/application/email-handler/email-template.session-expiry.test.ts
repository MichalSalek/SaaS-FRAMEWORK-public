import { describe, expect, it } from 'vitest';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import { SESSION_EXPIRY_DAYS_TOKEN } from '@kernel/domain/session-container/session-container.policy-text';
import {
  getEmailPreheader,
  renderEmailTemplate,
} from './email-template.renderer';

describe('shared inspiration email policy', () => {
  it.each(['pl', 'en', 'de'] as const)(
    'renders the configured window in both preheader and body in %s',
    locale => {
      const { html, text } = renderEmailTemplate(
        'session-shared-notification',
        {
          clientName: 'Anna',
          appUrl: 'https://nailfolio.app/app/inbox/session/test',
        },
        locale,
        '',
        'email.sessionSharedNotification.subject'
      );
      const days = String(SESSION_CONTAINER_CONFIG.SESSION_EXPIRY_DAYS);
      expect(getEmailPreheader(html)).toContain(days);
      expect(text).toContain(days);
      expect(html).not.toContain(SESSION_EXPIRY_DAYS_TOKEN);
      expect(text).not.toMatch(/14 (dni|days|Tage)/);
      expect(html).toContain('/app/inbox/session/test');
    }
  );
});
