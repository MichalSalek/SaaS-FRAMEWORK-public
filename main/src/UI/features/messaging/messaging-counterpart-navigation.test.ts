import { describe, expect, it } from 'vitest';
import type { MessagingThreadMeta } from '@kernel/models/messaging/messaging.dto';
import { counterpartNavigation } from './messaging-counterpart-navigation';

const meta = (
  overrides: Partial<MessagingThreadMeta> = {}
): MessagingThreadMeta => ({
  pair_id: 'pair',
  status: 'PENDING',
  relationship_state: 'CONTACT',
  counterpart_name: '',
  counterpart_avatar_url: null,
  counterpart_stylist_id: 'stylist-123',
  viewer_side: 'CLIENT',
  can_send: true,
  hidden_at: null,
  ...overrides,
});

describe('counterpartNavigation', () => {
  it('opens the profile and arms the existing confirmation for a contact', () => {
    expect(counterpartNavigation(meta())).toEqual({
      profileHref: '/stylist/stylist-123',
      requestHref: '/stylist/stylist-123?pair=1',
      isPendingRequest: false,
    });
  });

  it.each(['PENDING', 'ACTIVE', 'REVOKED'] as const)(
    'opens the profile without a new request intent for %s',
    relationship_state => {
      const result = counterpartNavigation(meta({ relationship_state }));
      expect(result.profileHref).toBe('/stylist/stylist-123');
      expect(result.requestHref).toBeNull();
      expect(result.isPendingRequest).toBe(relationship_state === 'PENDING');
    }
  );

  it('never offers a client profile to a stylist, even if an id arrives', () => {
    expect(counterpartNavigation(meta({ viewer_side: 'STYLIST' }))).toEqual({
      profileHref: null,
      requestHref: null,
      isPendingRequest: false,
    });
  });

  it('keeps old responses and unknown relationship states safe', () => {
    const oldMeta = meta();
    delete oldMeta.counterpart_stylist_id;
    expect(counterpartNavigation(oldMeta).profileHref).toBeNull();
    const unknownRelationship = meta();
    delete unknownRelationship.relationship_state;
    const result = counterpartNavigation(unknownRelationship);
    expect(result.profileHref).toBe('/stylist/stylist-123');
    expect(result.requestHref).toBeNull();
    expect(result.isPendingRequest).toBe(false);
  });
});
