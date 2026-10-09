import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// REASON: @kernel/models/db_models.generated.dto is under READONLY-shared-kernel whose
// tsconfig.json extends '../tsconfig.base.json' — a path Vite's esbuild cannot resolve
// from within the READONLY copy. Mock replicates exact runtime values.
vi.mock('@kernel/models/db_models.generated.dto', () => ({
  EventLogTypeValue: Object.freeze({
    ACCOUNT: 'ACCOUNT',
    LOGIN: 'LOGIN',
    GALLERY: 'GALLERY',
    ADMIN: 'ADMIN',
    DOMAIN: 'DOMAIN',
    EMAIL: 'EMAIL',
  }),
}));

import {
  deriveSeverity,
  describeAdminEvent,
  getSeverityColor,
  exportToCSV,
  PAGE_SIZE,
} from './AdminAuditPage.helpers';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import type { AuditTrailEntry } from './hooks/useAdminAuditTrail';

function makeEntry(overrides: Partial<AuditTrailEntry> = {}): AuditTrailEntry {
  return {
    id: 'entry-1',
    created_at: '2024-06-01T10:00:00.000Z',
    namespace: 'ACCOUNT',
    event_name: 'USER_CREATED',
    admin_name: 'Admin User',
    admin_email: 'admin@example.com',
    target_info: 'user@example.com',
    details: 'Created new user',
    ...overrides,
  } as AuditTrailEntry;
}

// ─── PAGE_SIZE ──────────────────────────────────────────────────────────────

describe('PAGE_SIZE', () => {
  it('is 15', () => {
    expect(PAGE_SIZE).toBe(15);
  });
});

// ─── deriveSeverity ─────────────────────────────────────────────────────────

describe('describeAdminEvent', () => {
  it('reuses the kernel Polish description', () => {
    expect(describeAdminEvent('USER_SWITCHED_BACK_TO_SELF')).toBe(
      'Administrator wrócił do swojego konta'
    );
  });

  it('returns null for an unknown name', () => {
    expect(describeAdminEvent('NOT_A_REAL_EVENT')).toBeNull();
  });
});

describe('deriveSeverity', () => {
  it('returns high for ADMIN namespace', () => {
    expect(deriveSeverity(EventLogTypeValue.ADMIN)).toBe('high');
  });

  it('returns medium for DOMAIN namespace', () => {
    expect(deriveSeverity(EventLogTypeValue.DOMAIN)).toBe('medium');
  });

  it('returns low for LOGIN namespace', () => {
    expect(deriveSeverity(EventLogTypeValue.LOGIN)).toBe('low');
  });

  it('returns low for ACCOUNT namespace (default)', () => {
    expect(deriveSeverity(EventLogTypeValue.ACCOUNT)).toBe('low');
  });

  it('returns low for GALLERY namespace (default)', () => {
    expect(deriveSeverity(EventLogTypeValue.GALLERY)).toBe('low');
  });

  it('returns low for EMAIL namespace (default)', () => {
    expect(deriveSeverity(EventLogTypeValue.EMAIL)).toBe('low');
  });

  it('returns low for unknown namespace', () => {
    expect(deriveSeverity('UNKNOWN_NAMESPACE')).toBe('low');
  });
});

// ─── getSeverityColor ───────────────────────────────────────────────────────

describe('getSeverityColor', () => {
  it('maps low severity to the informational role token', () => {
    expect(getSeverityColor('low')).toBe('var(--color-info)');
  });

  it('maps medium severity to the warning role token', () => {
    expect(getSeverityColor('medium')).toBe('var(--color-warning)');
  });

  it('maps high severity to the error role token', () => {
    expect(getSeverityColor('high')).toBe('var(--color-error)');
  });

  // Critical shares the error hue with high on purpose — the two are told
  // apart by the pill's solid fill, not by a fifth colour in the palette.
  it('maps critical severity to the error role token as well', () => {
    expect(getSeverityColor('critical')).toBe('var(--color-error)');
  });
});

// ─── exportToCSV ────────────────────────────────────────────────────────────

describe('exportToCSV', () => {
  let clickedHref: string | undefined;
  let clickedDownload: string | undefined;
  let revokedUrl: string | undefined;

  beforeEach(() => {
    clickedHref = undefined;
    clickedDownload = undefined;
    revokedUrl = undefined;

    // Stub URL.createObjectURL and URL.revokeObjectURL
    vi.stubGlobal('URL', {
      createObjectURL: (_blob: Blob) => 'blob:mock-url',
      revokeObjectURL: (url: string) => {
        revokedUrl = url;
      },
    });

    // Stub document.createElement to capture anchor behavior
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const anchor = {
          href: '',
          download: '',
          click: () => {
            clickedHref = anchor.href;
            clickedDownload = anchor.download;
          },
        };
        return anchor as unknown as HTMLElement;
      }
      return document.createElement(tag);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('triggers a download click', () => {
    const entries = [makeEntry()];
    exportToCSV(entries);
    expect(clickedHref).toBe('blob:mock-url');
  });

  it('revokes the object URL after clicking', () => {
    exportToCSV([makeEntry()]);
    expect(revokedUrl).toBe('blob:mock-url');
  });

  it('sets download filename with audit-log- prefix and current date', () => {
    exportToCSV([makeEntry()]);
    const today = new Date().toISOString().slice(0, 10);
    expect(clickedDownload).toBe(`audit-log-${today}.csv`);
  });

  it('handles empty entries array without throwing', () => {
    expect(() => exportToCSV([])).not.toThrow();
  });

  it('handles entries with null optional fields without throwing', () => {
    const entry = makeEntry({
      admin_name: null,
      admin_email: null,
      target_info: null,
    });
    expect(() => exportToCSV([entry])).not.toThrow();
  });

  it('wraps fields containing commas in double quotes', () => {
    // We verify via Blob construction — capture Blob content
    let blobContent = '';
    vi.stubGlobal(
      'Blob',
      class {
        constructor(parts: string[]) {
          blobContent = parts.join('');
        }
      }
    );

    const entry = makeEntry({ details: 'comma,in,details' });
    exportToCSV([entry]);
    expect(blobContent).toContain('"comma,in,details"');
  });

  it('escapes double-quotes within fields', () => {
    let blobContent = '';
    vi.stubGlobal(
      'Blob',
      class {
        constructor(parts: string[]) {
          blobContent = parts.join('');
        }
      }
    );

    const entry = makeEntry({ details: 'he said "hello"' });
    exportToCSV([entry]);
    expect(blobContent).toContain('"he said ""hello"""');
  });
});
