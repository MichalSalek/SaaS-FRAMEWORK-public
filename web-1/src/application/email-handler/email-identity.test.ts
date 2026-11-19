import { describe, expect, it } from 'vitest';
import {
  getEmailHeaders,
  getEmailIdentity,
  getEmailReplyTo,
} from './email-identity';

describe('customer email identity', () => {
  it('uses the approved team identity across primary and fallback providers', () => {
    const primary = getEmailIdentity();
    const fallback = getEmailIdentity('kontakt@mg.example.com');
    expect(primary.from).toBe('Ekipa Nailfolio! <contact@example.com>');
    expect(fallback.from).toBe('Ekipa Nailfolio! <kontakt@mg.example.com>');
    expect(primary.senderName).toBe('Ekipa Nailfolio!');
    expect(fallback.senderName).toBe(primary.senderName);
    expect(primary.replyTo).toBe('support@example.com');
    expect(fallback.replyTo).toBe(primary.replyTo);
  });

  it('adds reply routing without losing unsubscribe headers', () => {
    const headers = {
      'List-Unsubscribe': '<https://example.test/unsubscribe>',
    };
    expect(getEmailHeaders(headers)).toEqual({
      ...headers,
      'Reply-To': 'support@example.com',
    });
    expect(headers).not.toHaveProperty('Reply-To');
  });

  it('preserves explicit owner-alert reply targets, regardless of header case', () => {
    for (const key of ['Reply-To', 'reply-to', 'REPLY-TO']) {
      const headers = { [key]: 'sender@example.test' };
      expect(getEmailHeaders(headers)).toEqual(headers);
      expect(getEmailReplyTo(headers)).toBe('sender@example.test');
    }
  });
});
