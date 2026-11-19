/**
 * The ONE copy table (kernel notification-copy.config.ts) is complete at
 * runtime too: every type in every language has three non-empty lines, and a
 * `{name}` slot never appears where no name is substituted.
 */
import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_COPY,
  renderNotificationCopy,
} from '@kernel/domain/notifications/notification-copy.config';
import { NotificationTypeValue } from '@kernel/models/notifications/notifications.dto';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';

const LOCALES = Object.keys(NOTIFICATION_COPY) as LocaleType[];
const TYPES = Object.values(NotificationTypeValue);

describe('NOTIFICATION_COPY', () => {
  it('covers pl, en and de', () => {
    expect([...LOCALES].sort()).toEqual(['de', 'en', 'pl']);
  });

  it.each(LOCALES)('has every notification type in %s', locale => {
    for (const type of TYPES) {
      const copy = NOTIFICATION_COPY[locale][type];
      expect(copy, `${locale}.${type}`).toBeDefined();
      expect(copy.title.trim().length).toBeGreaterThan(0);
      expect(copy.titleNoName.trim().length).toBeGreaterThan(0);
      expect(copy.body.trim().length).toBeGreaterThan(0);
      expect(copy.titleNoName).not.toContain('{name}');
      expect(copy.body).not.toContain('{name}');
    }
  });

  it('a support reply never carries a person name, even when one is passed', () => {
    for (const locale of LOCALES) {
      const rendered = renderNotificationCopy(
        locale,
        NotificationTypeValue.SUPPORT_REPLY_RECEIVED,
        'Admin Name'
      );
      expect(rendered.title).not.toContain('Admin Name');
      expect(rendered.title).toContain('Nailfolio');
    }
  });
});
