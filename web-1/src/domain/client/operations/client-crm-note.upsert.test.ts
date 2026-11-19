import { describe, expect, it, vi } from 'vitest';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import { VALIDATION_MESSAGES } from '@kernel/domain/i18n/validation.i18n';
import { __setDb as mockDb } from '../../../test-utils/setup';
import { upsertClientCrmNote_IO } from './client-crm-note.operations';

const write = (
  note: string,
  plan: 'PRO' | 'FREE' = 'PRO',
  expectedUpdatedAt: string | null = null
) =>
  upsertClientCrmNote_IO({
    stylist_account_id: 'stylist',
    client_user_id: 'client',
    stylist_pricing_plan: plan,
    note,
    expected_updated_at: expectedUpdatedAt,
  });

const legacyWrite = (note: string) =>
  upsertClientCrmNote_IO({
    stylist_account_id: 'stylist',
    client_user_id: 'client',
    stylist_pricing_plan: 'PRO',
    note,
  });

function scenario(
  initial: string | null,
  initialRevision: string | null = null
) {
  let persisted = initial;
  let revision = initialRevision;
  const events: string[] = [];
  const updateMany = vi.fn(
    async ({
      data,
    }: {
      data: { crm_note: string | null; crm_note_updated_at: Date };
    }) => {
      events.push('write');
      persisted = data.crm_note;
      revision = data.crm_note_updated_at.toISOString();
      return { count: 1 };
    }
  );
  mockDb({
    $queryRaw: async () => {
      events.push('lock');
      return [{ id: 'pair' }];
    },
    clientStylistPair: {
      findUnique: async () => {
        events.push('read');
        return {
          crm_note: persisted,
          crm_note_updated_at: revision === null ? null : new Date(revision),
        };
      },
      updateMany,
    },
  });
  return { updateMany, events, currentRevision: () => revision };
}

describe('upsertClientCrmNote_IO dynamic manual length', () => {
  it('accepts the manual base cap in code points and reads its baseline under the pair lock', async () => {
    const { updateMany, events } = scenario(null);
    const note = '😀'.repeat(VISIT_CONFIG.CRM_NOTE_MAX);
    expect(await write(note)).toMatchObject({ success: true, data: { note } });
    expect(events).toEqual(['lock', 'read', 'write']);
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it('rejects manual growth over the base with the current typed localization token', async () => {
    const { updateMany } = scenario('existing');
    expect(await write('😀'.repeat(VISIT_CONFIG.CRM_NOTE_MAX + 1))).toEqual({
      success: false,
      error: {
        type: 'VALIDATION_ERROR',
        field: 'note',
        message: VALIDATION_MESSAGES.visit.crmNoteTooLong,
      },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('retains or edits a system-expanded note without imposing a smaller fixed cap', async () => {
    const baseline = '😀'.repeat(VISIT_CONFIG.CRM_NOTE_MAX + 300);
    const { currentRevision } = scenario(baseline);
    expect(await write(baseline)).toMatchObject({
      success: true,
      data: { note: baseline },
    });
    const edited = `X${Array.from(baseline).slice(1).join('')}`;
    expect(await write(edited, 'PRO', currentRevision())).toMatchObject({
      success: true,
      data: { note: edited },
    });
  });

  it('rejects growth over a system-expanded baseline and reduces the bound after a saved shrink', async () => {
    const baseline = 'x'.repeat(VISIT_CONFIG.CRM_NOTE_MAX + 300);
    const { updateMany, currentRevision } = scenario(baseline);
    expect(await write(`${baseline}x`)).toMatchObject({
      success: false,
      error: { type: 'VALIDATION_ERROR' },
    });
    const shrunk = baseline.slice(0, -20);
    expect((await write(shrunk)).success).toBe(true);
    expect(await write(baseline, 'PRO', currentRevision())).toMatchObject({
      success: false,
      error: { type: 'VALIDATION_ERROR' },
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('preserves the Free nonempty write gate', async () => {
    const { events, updateMany } = scenario('stored request');
    expect(await write('manual edit', 'FREE')).toMatchObject({
      success: false,
      error: { type: 'CLIENT_CARD_PLAN_LOCKED' },
    });
    expect(events).toEqual([]);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not read or write a baseline when no active pair is locked', async () => {
    const findUnique = vi.fn();
    const updateMany = vi.fn();
    mockDb({
      $queryRaw: async () => [],
      clientStylistPair: { findUnique, updateMany },
    });
    expect(await write('manual edit')).toMatchObject({
      success: false,
      error: { type: 'CLIENT_UNAUTHORIZED_ACCESS' },
    });
    expect(findUnique).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each(['legacy shrink', ''] as const)(
    'rejects a legacy oversized-note overwrite (%j)',
    async note => {
      const { updateMany } = scenario(
        '😀'.repeat(VISIT_CONFIG.CRM_NOTE_LEGACY_MAX + 1)
      );
      expect(await legacyWrite(note)).toEqual({
        success: false,
        error: {
          type: 'VALIDATION_ERROR',
          field: 'note',
          message: VALIDATION_MESSAGES.visit.crmNoteChanged,
        },
      });
      expect(updateMany).not.toHaveBeenCalled();
    }
  );

  it('still permits legacy writes against a baseline within the old code-point cap', async () => {
    scenario('😀'.repeat(VISIT_CONFIG.CRM_NOTE_LEGACY_MAX));
    expect((await legacyWrite('edited')).success).toBe(true);
  });

  it('allows a matching modern revision to shrink imported data and preserves Free clearing permission', async () => {
    const stamp = '2026-10-24T12:00:00.000Z';
    const { currentRevision } = scenario(
      'x'.repeat(VISIT_CONFIG.CRM_NOTE_MAX + 300),
      stamp
    );
    expect(await write('shorter', 'PRO', stamp)).toMatchObject({
      success: true,
      data: { note: 'shorter' },
    });
    expect(await write('', 'FREE', currentRevision())).toMatchObject({
      success: true,
      data: { note: null },
    });
  });

  it('rejects a stale modern revision after request context was appended, even on an empty blur', async () => {
    const { updateMany } = scenario(
      'existing\n\nClient connection request: new context',
      '2026-10-24T12:00:00.000Z'
    );
    for (const draft of ['old draft', '']) {
      expect(await write(draft, 'PRO', '2026-10-24T11:00:00.000Z')).toEqual({
        success: false,
        error: {
          type: 'VALIDATION_ERROR',
          field: 'note',
          message: VALIDATION_MESSAGES.visit.crmNoteChanged,
        },
      });
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('advances a same-millisecond retained revision so a second stale manual save conflicts', async () => {
    const stamp = '2026-10-24T12:00:00.000Z';
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValue(new Date(stamp).getTime());
    try {
      const { updateMany } = scenario('baseline', stamp);
      expect(await write('first edit', 'PRO', stamp)).toMatchObject({
        success: true,
        data: { updatedAt: '2026-10-24T12:00:00.001Z' },
      });
      expect(await write('stale edit', 'PRO', stamp)).toMatchObject({
        success: false,
        error: {
          type: 'VALIDATION_ERROR',
          message: VALIDATION_MESSAGES.visit.crmNoteChanged,
        },
      });
      expect(updateMany).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });
});
