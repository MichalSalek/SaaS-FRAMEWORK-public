/**
 * Relative time of a notification row: „teraz” under a minute, minutes,
 * hours, days (numeric 'auto' gives „wczoraj”), a calendar date from a week on.
 */
import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_ICONS,
  formatNotificationTime,
} from './notificationPresentation';
import { NotificationTypeValue } from '@kernel/models/notifications/notifications.dto';

const now = new Date('2026-10-19T12:00:00Z');
const minutesAgo = (m: number) =>
  new Date(now.getTime() - m * 60_000).toISOString();

describe('formatNotificationTime', () => {
  it('says now under a minute', () => {
    expect(formatNotificationTime(minutesAgo(0), now, 'pl')).toBe('teraz');
    expect(formatNotificationTime(minutesAgo(0), now, 'en')).toBe('now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(formatNotificationTime(minutesAgo(5), now, 'pl')).toBe(
      '5 minut temu'
    );
    expect(formatNotificationTime(minutesAgo(3 * 60), now, 'en')).toBe(
      '3 hours ago'
    );
    expect(formatNotificationTime(minutesAgo(24 * 60), now, 'pl')).toBe(
      'wczoraj'
    );
    expect(formatNotificationTime(minutesAgo(3 * 24 * 60), now, 'de')).toBe(
      'vor 3 Tagen'
    );
  });

  it('falls back to a calendar date from a week on and to nothing for garbage', () => {
    const weekOld = formatNotificationTime(minutesAgo(8 * 24 * 60), now, 'pl');
    expect(weekOld).toMatch(/2026/);
    expect(formatNotificationTime('not-a-date', now, 'pl')).toBe('');
  });

  it('a future timestamp (clock skew) still reads as now', () => {
    expect(formatNotificationTime(minutesAgo(-10), now, 'en')).toBe('now');
  });
});

describe('NOTIFICATION_ICONS', () => {
  it('has an icon for every notification type', () => {
    for (const type of Object.values(NotificationTypeValue)) {
      expect(NOTIFICATION_ICONS[type]).toBeDefined();
    }
  });
});
