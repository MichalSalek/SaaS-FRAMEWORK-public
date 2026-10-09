import { describe, it, expect, vi } from 'vitest';

// REASON: @kernel/models/db_models.generated.dto is under READONLY-shared-kernel whose
// tsconfig.json extends '../tsconfig.base.json' — a path Vite's esbuild cannot resolve.
// Mock replicates exact runtime values used by the tested helpers.
vi.mock('@kernel/models/db_models.generated.dto', () => ({
  SessionContainerLifecycleStateValue: Object.freeze({
    ACTIVE: 'ACTIVE',
    DRAFT: 'DRAFT',
    SHARED: 'SHARED',
    CLOSED: 'CLOSED',
  }),
}));

import {
  formatExpiryStatus,
  isExpiringSoon,
  isDraft,
  formatArchiveDate,
  getArchiveGroupKey,
  formatGroupLabel,
  getDisplayName,
  EXPIRING_SOON_MS,
} from './shared.helpers';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';

// Minimal stub for TShared translation function
function makeT(
  overrides: Record<string, string> = {}
): Parameters<typeof formatExpiryStatus>[1] {
  const defaults: Record<string, string> = {
    draft: 'Draft',
    expiredNeuter: 'Expired',
  };
  const map = { ...defaults, ...overrides };
  return ((key: string, params?: Record<string, unknown>) => {
    let result = map[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        result = result.replace(`{${k}}`, String(v));
      }
    }
    return result;
  }) as Parameters<typeof formatExpiryStatus>[1];
}

function makeSession(
  overrides: Partial<SessionContainerDTO> = {}
): SessionContainerDTO {
  return {
    id: 'sess-1',
    clientAccountId: 'cli-abcdefgh',
    clientName: null,
    clientUserId: null,
    stylistAccountId: null,
    name: null,
    lifecycleState: SessionContainerLifecycleStateValue.ACTIVE,
    stylistNote: null,
    clientNote: null,
    sharedAt: null,
    expiresAt: null,
    closedAt: null,
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
    photoCount: 0,
    ...overrides,
  };
}

describe('isExpiringSoon', () => {
  it('returns false when expiresAt is null', () => {
    expect(isExpiringSoon(null)).toBe(false);
  });

  it('returns false when already expired', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isExpiringSoon(past)).toBe(false);
  });

  it('returns false when expiry is far in the future (> 24h)', () => {
    const farFuture = new Date(Date.now() + 2 * EXPIRING_SOON_MS).toISOString();
    expect(isExpiringSoon(farFuture)).toBe(false);
  });

  it('returns true when expiry is within 24h window', () => {
    const soon = new Date(Date.now() + EXPIRING_SOON_MS / 2).toISOString();
    expect(isExpiringSoon(soon)).toBe(true);
  });

  it('returns true when expiry is just 1 minute away', () => {
    const almostNow = new Date(Date.now() + 60 * 1000).toISOString();
    expect(isExpiringSoon(almostNow)).toBe(true);
  });
});

// ─── isDraft ──────────────────────────────────────────────────────────────

describe('isDraft', () => {
  it('returns true when expiresAt is null', () => {
    expect(isDraft(null)).toBe(true);
  });

  it('returns false when expiresAt is a date string', () => {
    expect(isDraft('2025-01-01T00:00:00.000Z')).toBe(false);
  });
});

// ─── formatArchiveDate ────────────────────────────────────────────────────

describe('formatArchiveDate', () => {
  it('uses closedAt for CLOSED lifecycle state', () => {
    const session = makeSession({
      lifecycleState: SessionContainerLifecycleStateValue.CLOSED,
      closedAt: '2024-03-15T12:00:00.000Z',
      sharedAt: '2024-03-01T00:00:00.000Z',
    });
    const result = formatArchiveDate(session, 'en-US');
    expect(result).toContain('2024');
    expect(result).toContain('15');
  });

  it('falls back to sharedAt when closedAt is null for CLOSED state', () => {
    const session = makeSession({
      lifecycleState: SessionContainerLifecycleStateValue.CLOSED,
      closedAt: null,
      sharedAt: '2024-04-10T00:00:00.000Z',
    });
    const result = formatArchiveDate(session, 'en-US');
    expect(result).toContain('2024');
    expect(result).toContain('10');
  });

  it('falls back to createdAt when closedAt and sharedAt are null for CLOSED state', () => {
    const session = makeSession({
      lifecycleState: SessionContainerLifecycleStateValue.CLOSED,
      closedAt: null,
      sharedAt: null,
      createdAt: '2024-05-20T00:00:00.000Z',
    });
    const result = formatArchiveDate(session, 'en-US');
    expect(result).toContain('2024');
  });

  it('uses expiresAt for non-CLOSED lifecycle state', () => {
    const session = makeSession({
      lifecycleState: SessionContainerLifecycleStateValue.ACTIVE,
      expiresAt: '2024-06-30T00:00:00.000Z',
    });
    const result = formatArchiveDate(session, 'en-US');
    expect(result).toContain('2024');
    expect(result).toContain('30');
  });

  it('returns empty string when no timestamp is available', () => {
    const session = makeSession({
      lifecycleState: SessionContainerLifecycleStateValue.ACTIVE,
      expiresAt: null,
    });
    expect(formatArchiveDate(session, 'en-US')).toBe('');
  });
});

// ─── getArchiveGroupKey ───────────────────────────────────────────────────

describe('getArchiveGroupKey', () => {
  it('returns YYYY-MM key using closedAt for CLOSED state', () => {
    const session = makeSession({
      lifecycleState: SessionContainerLifecycleStateValue.CLOSED,
      closedAt: '2024-03-15T12:00:00.000Z',
    });
    expect(getArchiveGroupKey(session)).toBe('2024-03');
  });

  it('returns YYYY-MM key using expiresAt for ACTIVE state', () => {
    const session = makeSession({
      lifecycleState: SessionContainerLifecycleStateValue.ACTIVE,
      expiresAt: '2024-11-05T00:00:00.000Z',
    });
    expect(getArchiveGroupKey(session)).toBe('2024-11');
  });

  it('pads single-digit months with leading zero', () => {
    const session = makeSession({
      lifecycleState: SessionContainerLifecycleStateValue.ACTIVE,
      expiresAt: '2024-01-01T00:00:00.000Z',
    });
    expect(getArchiveGroupKey(session)).toBe('2024-01');
  });

  it('falls back to sharedAt when expiresAt is null for non-CLOSED state', () => {
    const session = makeSession({
      lifecycleState: SessionContainerLifecycleStateValue.ACTIVE,
      expiresAt: null,
      sharedAt: '2024-07-20T00:00:00.000Z',
    });
    expect(getArchiveGroupKey(session)).toBe('2024-07');
  });

  it('falls back to createdAt when expiresAt and sharedAt are null for non-CLOSED state', () => {
    const session = makeSession({
      lifecycleState: SessionContainerLifecycleStateValue.ACTIVE,
      expiresAt: null,
      sharedAt: null,
      createdAt: '2024-09-10T00:00:00.000Z',
    });
    expect(getArchiveGroupKey(session)).toBe('2024-09');
  });
});

// ─── formatGroupLabel ─────────────────────────────────────────────────────

describe('formatGroupLabel', () => {
  it('returns a non-empty string for a valid YYYY-MM key', () => {
    const label = formatGroupLabel('2024-03', 'en-US');
    expect(label).toBeTruthy();
    expect(label.length).toBeGreaterThan(0);
  });

  it('capitalizes first letter', () => {
    const label = formatGroupLabel('2024-03', 'pl-PL');
    expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase());
  });

  it('includes the year in the output', () => {
    const label = formatGroupLabel('2024-03', 'en-US');
    expect(label).toContain('2024');
  });

  it('handles December correctly', () => {
    const label = formatGroupLabel('2024-12', 'en-US');
    expect(label).toContain('2024');
  });

  it('handles January correctly', () => {
    const label = formatGroupLabel('2024-01', 'en-US');
    expect(label).toContain('2024');
  });
});

// ─── getDisplayName ───────────────────────────────────────────────────────

describe('getDisplayName', () => {
  it('prefers clientName over the session name (sender identity)', () => {
    const session = makeSession({
      clientName: 'Anna Kowalska',
      name: 'My Session',
    });
    expect(getDisplayName(session, 'Klientka')).toBe('Anna Kowalska');
  });

  it('trims surrounding whitespace on clientName', () => {
    const session = makeSession({ clientName: '  Ola Nowak  ', name: null });
    expect(getDisplayName(session, 'Klientka')).toBe('Ola Nowak');
  });

  it('falls back to session.name when clientName is null', () => {
    const session = makeSession({ clientName: null, name: 'My Session' });
    expect(getDisplayName(session, 'Session')).toBe('My Session');
  });

  it('falls back to session.name when clientName is only whitespace', () => {
    const session = makeSession({ clientName: '   ', name: 'Wiosna 2026' });
    expect(getDisplayName(session, 'Klientka')).toBe('Wiosna 2026');
  });

  it('returns the bare fallback when neither clientName nor name is set', () => {
    const session = makeSession({ clientName: null, name: null });
    expect(getDisplayName(session, 'Klientka')).toBe('Klientka');
  });

  it('returns the bare fallback when both clientName and name are whitespace', () => {
    const session = makeSession({ clientName: '  ', name: '   ' });
    expect(getDisplayName(session, 'Klientka')).toBe('Klientka');
  });
});

describe('formatExpiryStatus', () => {
  it('has no date line for a draft', () => {
    expect(formatExpiryStatus(null, makeT())).toBeNull();
  });

  it('says the session ran out once the expiry passed', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(formatExpiryStatus(past, makeT())).toBe('Expired');
  });

  // The stylist's list words the expiry like the client's list: whole days,
  // then whole hours, then "very soon" (never a "2d 0h" countdown pair).
  it('speaks in whole days while at least one day is left', () => {
    const inTwoDays = new Date(
      Date.now() + 2 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000
    ).toISOString();
    expect(formatExpiryStatus(inTwoDays, makeT())).toBe('expiresInDays');
  });

  it('speaks in whole hours on the last day', () => {
    const inFiveHours = new Date(
      Date.now() + 5 * 60 * 60 * 1000 + 60_000
    ).toISOString();
    expect(formatExpiryStatus(inFiveHours, makeT())).toBe('expiresInHours');
  });

  it('says "very soon" in the last hour', () => {
    const inTenMinutes = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    expect(formatExpiryStatus(inTenMinutes, makeT())).toBe('expiresSoon');
  });
});
