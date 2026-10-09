import { describe, expect, it } from 'vitest';
import type { EventLogRecordFromDB } from '@kernel/models/admin/admin.dto';
import type { LogIssueGroup } from '@kernel/models/admin/admin-logs.dto';
import { adminLogsAttentionHref } from '@kernel/domain/admin/admin-logs-url.config';
import {
  activeQuickFilterIds,
  ADMIN_LOGS_URL_CODEC,
  EMPTY_LOCAL_FILTERS,
  EMPTY_SCOPE,
  filterGroupRows,
  filterLogRows,
  countActiveFilters,
  toDateInputValue,
  toggleQuickFilter,
  type LogsLocalFilters,
} from './logs-filters.model';

// Guard kontraktu presetów. Ich sens polega na tym, że stan „wciśnięty" jest
// POCHODNY od filtrów — przycisk nie może świecić się dla stanu, którego już nie ma,
// a zwolnienie go nie może kasować wymiarów ustawionych ręcznie obok.

const NOW = new Date('2026-08-19T12:00:00');

const localWith = (patch: Partial<LogsLocalFilters>): LogsLocalFilters => ({
  ...EMPTY_LOCAL_FILTERS,
  ...patch,
});

describe('presety filtrów logów', () => {
  it('bez filtrów żaden preset nie jest wciśnięty', () => {
    expect(activeQuickFilterIds(EMPTY_SCOPE, EMPTY_LOCAL_FILTERS, NOW)).toEqual(
      []
    );
  });

  it('wciśnięcie ustawia KOMPLET wymiarów, które preset obiecuje', () => {
    const next = toggleQuickFilter(
      'prodFailures',
      EMPTY_SCOPE,
      EMPTY_LOCAL_FILTERS,
      NOW
    );
    expect(next.scope).toEqual({ type: 'error', environment: 'PRODUCTION' });
    expect(activeQuickFilterIds(next.scope, next.local, NOW)).toContain(
      'prodFailures'
    );
  });

  it('ręczna zmiana wymiaru ODCISKA preset (stan pochodny, nie własny boolean)', () => {
    const pressed = toggleQuickFilter(
      'prodFailures',
      EMPTY_SCOPE,
      EMPTY_LOCAL_FILTERS,
      NOW
    );
    const editedByHand = { ...pressed.scope, type: 'warn' as const };

    expect(
      activeQuickFilterIds(editedByHand, pressed.local, NOW)
    ).not.toContain('prodFailures');
  });

  it('zwolnienie czyści TYLKO to, co preset ustawił', () => {
    const pressed = toggleQuickFilter(
      'prodFailures',
      EMPTY_SCOPE,
      EMPTY_LOCAL_FILTERS,
      NOW
    );
    // Wymiar dołożony ręcznie obok presetu.
    const withExtra = { ...pressed.scope, application: 'backend' as const };

    const released = toggleQuickFilter(
      'prodFailures',
      withExtra,
      pressed.local,
      NOW
    );

    expect(released.scope.type).toBeUndefined();
    expect(released.scope.environment).toBeUndefined();
    expect(released.scope.application).toBe('backend');
  });

  it('preset czasowy ustawia datę od wczoraj i sam się rozpoznaje', () => {
    const next = toggleQuickFilter(
      'lastDay',
      EMPTY_SCOPE,
      EMPTY_LOCAL_FILTERS,
      NOW
    );
    expect(next.local.dateFrom).toBe(
      toDateInputValue(new Date('2026-08-18T12:00:00'))
    );
    expect(activeQuickFilterIds(next.scope, next.local, NOW)).toContain(
      'lastDay'
    );
  });

  it('dwa presety dzielące wymiar współistnieją, a zwolnienie jednego nie gasi drugiego na ślepo', () => {
    const first = toggleQuickFilter(
      'prodFailures',
      EMPTY_SCOPE,
      EMPTY_LOCAL_FILTERS,
      NOW
    );
    const both = toggleQuickFilter(
      'noStartupNoise',
      first.scope,
      first.local,
      NOW
    );
    expect(activeQuickFilterIds(both.scope, both.local, NOW)).toEqual(
      expect.arrayContaining(['prodFailures', 'noStartupNoise'])
    );

    const released = toggleQuickFilter(
      'noStartupNoise',
      both.scope,
      both.local,
      NOW
    );
    expect(activeQuickFilterIds(released.scope, released.local, NOW)).toEqual([
      'prodFailures',
    ]);
  });

  it('liczy ustawione filtry, a szukajki nie wlicza', () => {
    expect(countActiveFilters(EMPTY_SCOPE, EMPTY_LOCAL_FILTERS)).toBe(0);
    expect(countActiveFilters({ type: 'error' }, EMPTY_LOCAL_FILTERS)).toBe(1);
    expect(countActiveFilters(EMPTY_SCOPE, localWith({ search: 'boom' }))).toBe(
      0
    );
    expect(
      countActiveFilters(
        { type: 'error', environment: 'PRODUCTION' },
        localWith({ dateFrom: '2026-10-01', hideStartupNoise: true })
      )
    ).toBe(4);
  });
});

const logRow = (patch: Partial<EventLogRecordFromDB>): EventLogRecordFromDB =>
  ({
    id: '1',
    created_at: '2026-08-19T10:00:00.000Z',
    event_log_chain_id: '0',
    type: 'error',
    namespace: 'GALLERY',
    message: 'coś padło',
    payload: '{}',
    user_metadata: '{}',
    client_url: 'POST /api/v1/gallery',
    application: 'backend',
    environment: 'PRODUCTION',
    ...patch,
  }) as EventLogRecordFromDB;

describe('filtrowanie strumienia po stronie klienta', () => {
  it('szuka także po źródle (client_url niesie realny endpoint)', () => {
    const rows = [
      logRow({
        id: '1',
        namespace: 'UPLOAD',
        client_url: 'POST /api/v1/gallery',
      }),
      logRow({
        id: '2',
        namespace: 'ACCOUNT',
        client_url: 'GET /api/v1/account',
      }),
    ];
    expect(
      filterLogRows(rows, localWith({ search: 'gallery' })).map(r => r.id)
    ).toEqual(['1']);
  });

  it('ukrywa szum startowy tylko po włączeniu presetu', () => {
    const rows = [
      logRow({ id: '1', namespace: 'STARTUP' }),
      logRow({ id: '2', namespace: 'GALLERY' }),
    ];
    expect(filterLogRows(rows, EMPTY_LOCAL_FILTERS)).toHaveLength(2);
    expect(
      filterLogRows(rows, localWith({ hideStartupNoise: true })).map(r => r.id)
    ).toEqual(['2']);
  });
});

const group = (patch: Partial<LogIssueGroup>): LogIssueGroup => ({
  fingerprint: 'a'.repeat(32),
  application: 'backend',
  type: 'error',
  namespace: 'GALLERY',
  sample_message: 'coś padło',
  sample_id: '42',
  count: 3,
  first_seen: '2026-08-01T10:00:00.000Z',
  last_seen: '2026-08-19T10:00:00.000Z',
  status: 'new',
  note: null,
  status_updated_at: null,
  ...patch,
});

describe('filtrowanie grup', () => {
  it('„do ogarnięcia" odsiewa tematy zamknięte, ale ZOSTAWIA nawroty', () => {
    const groups = [
      group({ fingerprint: '1'.repeat(32), status: 'new' }),
      group({ fingerprint: '2'.repeat(32), status: 'known' }),
      group({ fingerprint: '3'.repeat(32), status: 'fixed' }),
      group({ fingerprint: '4'.repeat(32), status: 'ignored' }),
      group({ fingerprint: '5'.repeat(32), status: 'regressed' }),
    ];

    const open = filterGroupRows(groups, localWith({ onlyOpenIssues: true }));
    expect(open.map(g => g.status)).toEqual(['new', 'known', 'regressed']);
  });
});

describe('kodek URL logów', () => {
  it('pusty query wraca do wartości domyślnych i buduje pusty URL', () => {
    const state = ADMIN_LOGS_URL_CODEC.parse({});
    expect(state.view).toBe('stream');
    expect(state.logId).toBeNull();
    expect(state.local).toEqual(EMPTY_LOCAL_FILTERS);
    expect(ADMIN_LOGS_URL_CODEC.build(state)).toEqual({});
  });

  it('odtwarza filtry i otwarty wpis, a nieznane wartości odrzuca', () => {
    const query = {
      view: 'groups',
      type: 'error',
      application: 'backend',
      environment: 'PRODUCTION',
      q: 'quota',
      from: '2026-09-01',
      to: '2026-09-22',
      noise: '1',
      open: '1',
      log: '4815',
    };
    const state = ADMIN_LOGS_URL_CODEC.parse(query);
    expect(ADMIN_LOGS_URL_CODEC.build(state)).toEqual(query);
    expect(
      ADMIN_LOGS_URL_CODEC.parse({
        type: 'nope',
        from: 'yesterday',
        log: 'abc',
        view: ['groups', 'stream'],
      }).view
    ).toBe('groups');
  });
  it('lista spod badge: attention wymusza widok grup i wraca do adresu z jądra', () => {
    const state = ADMIN_LOGS_URL_CODEC.parse({ attention: '1' });
    expect(state.attention).toBe(true);
    expect(state.view).toBe('groups');
    expect(ADMIN_LOGS_URL_CODEC.build(state)).toEqual(
      Object.fromEntries(
        new URLSearchParams(adminLogsAttentionHref().split('?')[1])
      )
    );
    expect(ADMIN_LOGS_URL_CODEC.parse({ attention: 'yes' }).attention).toBe(
      false
    );
  });
});
