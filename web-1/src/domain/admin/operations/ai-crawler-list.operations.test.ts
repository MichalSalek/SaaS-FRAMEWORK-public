import { describe, expect, it } from 'vitest';
import { parseInclusiveEndDate } from './ai-crawler-list.operations';

describe('parseInclusiveEndDate', () => {
  it('reads a bare day as the end of that day, so the day itself is included', () => {
    expect(parseInclusiveEndDate('2026-10-09')?.toISOString()).toBe(
      '2026-10-09T23:59:59.999Z'
    );
  });

  it('keeps a full timestamp exact', () => {
    expect(
      parseInclusiveEndDate('2026-10-09T12:30:00.000Z')?.toISOString()
    ).toBe('2026-10-09T12:30:00.000Z');
  });

  it('passes through no value and an unreadable one', () => {
    expect(parseInclusiveEndDate(null)).toBeNull();
    expect(parseInclusiveEndDate('not-a-date')).toBeNull();
  });
});
