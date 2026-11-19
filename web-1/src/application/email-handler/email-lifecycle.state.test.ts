import { describe, expect, it } from 'vitest';
import { isEmailQuietHours } from './email-lifecycle.state';

const at = (iso: string) => new Date(iso);

describe('isEmailQuietHours', () => {
  it('is quiet from 21:00 UTC until just before 09:00 UTC', () => {
    expect(isEmailQuietHours(at('2026-09-24T20:59:59Z'))).toBe(false);
    expect(isEmailQuietHours(at('2026-09-24T21:00:00Z'))).toBe(true);
    expect(isEmailQuietHours(at('2026-09-24T03:00:00Z'))).toBe(true);
    expect(isEmailQuietHours(at('2026-09-24T08:59:59Z'))).toBe(true);
    expect(isEmailQuietHours(at('2026-09-24T09:00:00Z'))).toBe(false);
  });
});
