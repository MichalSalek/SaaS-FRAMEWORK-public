/**
 * getPrivateNotes_IO — the stylist's private notes hub (/app/notes).
 *
 * Locks in: the plan gate keeps client-card and visit notes away from Free
 * (no pair or visit query at all), a session yields one row per note with an
 * honest author, blank notes never surface, every list is capped with a
 * truncation flag, the client filter narrows every list and a bad filter is a
 * VALIDATION_ERROR, and the session predicate mirrors the session screen.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  getPrivateNotes_IO,
  readableSessionWhere,
} from './private-notes-query.operations';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { PRIVATE_NOTES_CONFIG } from '@kernel/domain/private-notes/private-notes.config';
import { sessionStylistRelationshipWhere } from '@domain/session-container/session-activity.access';

const STYLIST = 'acc_test_0000000000000001';
const ANIA = { id: 'usr_ania', name: 'Ania' };
const BASIA = { id: 'usr_basia', name: '  ' };

const session = (
  n: number,
  notes: { stylist?: string | null; client?: string | null },
  user = ANIA
) => ({
  id: `sess_${n}`,
  name: n === 1 ? 'Wesele' : null,
  stylist_note: notes.stylist ?? null,
  client_note: notes.client ?? null,
  updated_at: new Date(Date.UTC(2026, 9, n)),
  client_account: { created_by_user: user },
});

const pair = (user: typeof ANIA, note: string | null, day: number) => ({
  client_user_id: user.id,
  crm_note: note,
  crm_note_updated_at: note ? new Date(Date.UTC(2026, 8, day)) : null,
  client_user: user,
});

const important = (user: typeof ANIA, note: string | null, day: number) => ({
  important_note: note,
  important_note_updated_at: note ? new Date(Date.UTC(2026, 9, day)) : null,
  client_user: user,
});

const visit = (n: number, note: string | null, user = ANIA) => ({
  id: `visit_${n}`,
  service_note: note,
  visit_date: new Date(Date.UTC(2026, 7, n)),
  client_user: user,
});

const mockScenario = ({
  sessions = [] as ReturnType<typeof session>[],
  pairs = [] as ReturnType<typeof pair>[],
  visits = [] as ReturnType<typeof visit>[],
  importants = [] as ReturnType<typeof important>[],
} = {}) => {
  const sessionFindMany = vi.fn(async (args: { distinct?: string[] }) =>
    args.distinct
      ? sessions.map(s => ({ client_account: s.client_account }))
      : sessions
  );
  // The important-note read is the pair query that filters on important_note.
  const pairFindMany = vi.fn(
    async (args: { where: Record<string, unknown> }) =>
      'important_note' in args.where ? importants : pairs
  );
  const crmPairCalls = () =>
    pairFindMany.mock.calls.filter(
      ([args]) => !('important_note' in args.where)
    );
  const visitFindMany = vi.fn(async (args: { distinct?: string[] }) =>
    args.distinct ? visits.map(v => ({ client_user: v.client_user })) : visits
  );
  mockDb({
    sessionContainer: { findMany: sessionFindMany },
    clientStylistPair: { findMany: pairFindMany },
    visitRecord: { findMany: visitFindMany },
  });
  return { sessionFindMany, pairFindMany, visitFindMany, crmPairCalls };
};

describe('getPrivateNotes_IO', () => {
  it('Free: session notes only, history locked, no client-card or visit query', async () => {
    const { crmPairCalls, visitFindMany } = mockScenario({
      sessions: [session(2, { stylist: 'Lubi migdał' })],
      pairs: [pair(ANIA, 'Uczulenie na akryl', 1)],
    });
    const result = await getPrivateNotes_IO({
      stylist_account_id: STYLIST,
      stylist_pricing_plan: PricingPlanValue.FREE,
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.history_locked).toBe(true);
    expect(result.data.client_notes).toEqual([]);
    expect(result.data.visit_notes).toEqual([]);
    expect(result.data.session_notes).toHaveLength(1);
    expect(crmPairCalls()).toHaveLength(0);
    expect(visitFindMany).not.toHaveBeenCalled();
  });

  it('a session with both notes gives two rows, each with its real author; blanks are dropped', async () => {
    mockScenario({
      sessions: [
        session(1, {
          stylist: ' Krótkie, nude ',
          client: 'Chcę coś na wesele',
        }),
        session(2, { stylist: '   ', client: null }),
      ],
    });
    const result = await getPrivateNotes_IO({
      stylist_account_id: STYLIST,
      stylist_pricing_plan: PricingPlanValue.PRO,
    });
    if (!result.success) {
      throw new Error('expected success');
    }
    expect(
      result.data.session_notes.map(n => [n.session_id, n.author, n.note])
    ).toEqual([
      ['sess_1', 'STYLIST', 'Krótkie, nude'],
      ['sess_1', 'CLIENT', 'Chcę coś na wesele'],
    ]);
    expect(result.data.session_notes[0]?.session_name).toBe('Wesele');
  });

  it('Pro: client-card notes newest first, empty notes skipped, nameless client gets null', async () => {
    mockScenario({
      pairs: [
        pair(ANIA, 'Lubi pastele', 3),
        pair(BASIA, 'Ma krótkie płytki', 9),
        pair({ id: 'usr_cela', name: 'Cela' }, null, 0),
      ],
      visits: [visit(5, 'Hybryda, French'), visit(4, '  ')],
    });
    const result = await getPrivateNotes_IO({
      stylist_account_id: STYLIST,
      stylist_pricing_plan: PricingPlanValue.PRO,
    });
    if (!result.success) {
      throw new Error('expected success');
    }
    expect(result.data.history_locked).toBe(false);
    expect(result.data.client_notes.map(n => n.client.client_user_id)).toEqual([
      'usr_basia',
      'usr_ania',
    ]);
    expect(result.data.client_notes[0]?.client.name).toBeNull();
    expect(result.data.visit_notes.map(n => n.visit_id)).toEqual(['visit_5']);
    expect(result.data.clients.map(c => c.client_user_id).sort()).toEqual([
      'usr_ania',
      'usr_basia',
    ]);
  });

  it('caps every list at LIST_MAX and says so', async () => {
    const many = Array.from(
      { length: PRIVATE_NOTES_CONFIG.LIST_MAX + 1 },
      (_, i) => session(i + 1, { stylist: `notatka ${i}` })
    );
    mockScenario({ sessions: many });
    const result = await getPrivateNotes_IO({
      stylist_account_id: STYLIST,
      stylist_pricing_plan: PricingPlanValue.PRO,
    });
    if (!result.success) {
      throw new Error('expected success');
    }
    expect(result.data.session_notes).toHaveLength(
      PRIVATE_NOTES_CONFIG.LIST_MAX
    );
    expect(result.data.session_notes_truncated).toBe(true);
    expect(result.data.client_notes_truncated).toBe(false);
  });

  it('client filter narrows the client-card list and the session query, the filter list stays whole', async () => {
    const { sessionFindMany } = mockScenario({
      pairs: [pair(ANIA, 'Lubi pastele', 3), pair(BASIA, 'Krótkie', 9)],
    });
    const result = await getPrivateNotes_IO({
      stylist_account_id: STYLIST,
      stylist_pricing_plan: PricingPlanValue.PRO,
      client_user_id: 'usr_ania',
    });
    if (!result.success) {
      throw new Error('expected success');
    }
    expect(result.data.client_notes.map(n => n.client.client_user_id)).toEqual([
      'usr_ania',
    ]);
    expect(result.data.clients).toHaveLength(2);
    const listCall = sessionFindMany.mock.calls.find(
      ([args]) => (args as { distinct?: unknown }).distinct === undefined
    )?.[0] as {
      where: { client_account: { created_by_user_id: string }; AND: unknown[] };
    };
    expect(listCall.where.client_account.created_by_user_id).toBe('usr_ania');
    expect(listCall.where.AND).toContainEqual(
      sessionStylistRelationshipWhere(STYLIST)
    );
  });

  it('an over-long filter is a VALIDATION_ERROR before any query', async () => {
    const { sessionFindMany } = mockScenario();
    const result = await getPrivateNotes_IO({
      stylist_account_id: STYLIST,
      stylist_pricing_plan: PricingPlanValue.PRO,
      client_user_id: 'x'.repeat(PRIVATE_NOTES_CONFIG.CLIENT_ID_MAX + 1),
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.type).toBe('VALIDATION_ERROR');
    expect(sessionFindMany).not.toHaveBeenCalled();
  });

  it('a database failure maps to DATABASE_ERROR', async () => {
    mockDb({
      sessionContainer: {
        findMany: vi.fn(async () => {
          throw new Error('boom');
        }),
      },
    });
    const result = await getPrivateNotes_IO({
      stylist_account_id: STYLIST,
      stylist_pricing_plan: PricingPlanValue.PRO,
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.type).toBe('DATABASE_ERROR');
  });
});

describe('readableSessionWhere — mirror of the session screen rules', () => {
  it('only her shared sessions, never DRAFT/READY, active client, with a note', () => {
    expect(readableSessionWhere(STYLIST)).toEqual({
      stylist_account_id: STYLIST,
      shared_at: { not: null },
      lifecycle_state: { notIn: ['DRAFT', 'READY'] },
      client_account: { created_by_user: { is_active: true } },
      AND: [sessionStylistRelationshipWhere(STYLIST)],
      OR: [{ stylist_note: { not: null } }, { client_note: { not: null } }],
    });
  });
});

describe('getPrivateNotes_IO — „Ważne przed wizytą”', () => {
  it('Free still gets the important notes (no plan gate), blanks dropped, clients listed', async () => {
    const { pairFindMany } = mockScenario({
      importants: [
        important(ANIA, ' Uczulenie na aceton ', 3),
        important(BASIA, '   ', 2),
      ],
    });
    const result = await getPrivateNotes_IO({
      stylist_account_id: STYLIST,
      stylist_pricing_plan: PricingPlanValue.FREE,
    });
    if (!result.success) {
      throw new Error('expected success');
    }
    expect(result.data.history_locked).toBe(true);
    expect(result.data.important_notes).toEqual([
      {
        client: { client_user_id: ANIA.id, name: 'Ania' },
        note: 'Uczulenie na aceton',
        updated_at: new Date(Date.UTC(2026, 9, 3)).toISOString(),
      },
    ]);
    expect(result.data.important_notes_truncated).toBe(false);
    expect(result.data.clients.map(c => c.client_user_id)).toEqual([ANIA.id]);
    const importantCall = pairFindMany.mock.calls.find(
      ([args]) => 'important_note' in args.where
    );
    expect(importantCall?.[0].where).toMatchObject({
      stylist_account_id: STYLIST,
      status: 'ACTIVE',
      client_user: { is_active: true },
    });
  });

  it('the client filter narrows the important notes too', async () => {
    mockScenario({
      importants: [
        important(ANIA, 'Uczulenie na aceton', 3),
        important({ id: 'usr_cela', name: 'Cela' }, 'Wrażliwe skórki', 2),
      ],
    });
    const result = await getPrivateNotes_IO({
      stylist_account_id: STYLIST,
      stylist_pricing_plan: PricingPlanValue.PRO,
      client_user_id: 'usr_cela',
    });
    if (!result.success) {
      throw new Error('expected success');
    }
    expect(result.data.important_notes.map(n => n.note)).toEqual([
      'Wrażliwe skórki',
    ]);
  });
});
