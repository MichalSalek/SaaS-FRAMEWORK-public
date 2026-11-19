import { describe, expect, it } from 'vitest';
import { sortUnreadFirst } from './messaging.helpers';

const row = (id: string, unread: number) => ({ id, unread_count: unread });

describe('sortUnreadFirst', () => {
  it('moves unread conversations to the top and keeps the API order inside each group', () => {
    const input = [row('a', 0), row('b', 2), row('c', 0), row('d', 1)];
    expect(sortUnreadFirst(input).map(c => c.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('returns the same order when nothing or everything is unread', () => {
    const allRead = [row('a', 0), row('b', 0)];
    const allUnread = [row('a', 1), row('b', 3)];
    expect(sortUnreadFirst(allRead).map(c => c.id)).toEqual(['a', 'b']);
    expect(sortUnreadFirst(allUnread).map(c => c.id)).toEqual(['a', 'b']);
  });

  it('does not mutate its input', () => {
    const input = [row('a', 0), row('b', 1)];
    sortUnreadFirst(input);
    expect(input.map(c => c.id)).toEqual(['a', 'b']);
  });
});
