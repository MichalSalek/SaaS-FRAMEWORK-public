import { describe, expect, it } from 'vitest';
import type { MessagingMessageDTO } from '@kernel/models/messaging/messaging.dto';
import { mergeThreadMessages } from './useMessageThread';

const card: MessagingMessageDTO = {
  id: 'card',
  sender_type: 'CLIENT',
  content: 'old',
  created_at: '2026-01-01T00:00:00Z',
  revision: 1,
};
describe('thread page merge', () => {
  it('keeps older pages while replacing an existing card with a newer revision', () => {
    const older = { ...card, id: 'older' };
    const revised = { ...card, revision: 2, content: 'new' };
    const merged = mergeThreadMessages(
      new Map([
        [card.id, card],
        [older.id, older],
      ]),
      [revised]
    );
    expect(merged.get('card')).toEqual(revised);
    expect(merged.get('older')).toEqual(older);
    expect(mergeThreadMessages(merged, [card], false).get('card')).toEqual(
      revised
    );
  });
  it('refreshes an unchanged revision on a live poll, but a late older page cannot undo its preview', () => {
    const fresh = {
      ...card,
      session_preview: { thumbnails: ['fresh'], remaining_count: 0 },
    };
    const polled = mergeThreadMessages(new Map([[card.id, card]]), [fresh]);
    expect(mergeThreadMessages(polled, [card], false).get('card')).toEqual(
      fresh
    );
  });
});
