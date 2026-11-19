import { describe, it, expect } from 'vitest';
import {
  adminNewUsersWindowStartDay,
  adminUsersBlockedHref,
  adminUsersRegisteredFromHref,
  adminUsersPaymentsAttentionHref,
  adminUsersStuckHref,
  adminUserHref,
  adminUsersWithoutRoleHref,
} from '@kernel/domain/admin/admin-users-url.config';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import {
  adminUserDisplayName,
  adminUserRoleLabelKey,
  buildAdminUsersQuery,
  parseAdminUsersQuery,
  ROLE_FILTER_NO_ROLE,
  DEFAULT_SORT_DIR,
  DEFAULT_SORT_KEY,
  buildRequest,
  INITIAL_FILTERS,
  PAGE_SIZE,
  SORT_KEY_MAP,
  SORTABLE_KEYS,
  firstSortDir,
  nextSort,
  type FilterState,
} from './AdminUsersPage.helpers';

// ─── constants ────────────────────────────────────────────────────────────────

describe('PAGE_SIZE', () => {
  it('is 15', () => {
    expect(PAGE_SIZE).toBe(15);
  });
});

describe('INITIAL_FILTERS', () => {
  it('has empty search', () => {
    expect(INITIAL_FILTERS.search).toBe('');
  });

  it('has all roles set to "all"', () => {
    expect(INITIAL_FILTERS.role).toBe('all');
    expect(INITIAL_FILTERS.plan).toBe('all');
    expect(INITIAL_FILTERS.accountStatus).toBe('all');
    expect(INITIAL_FILTERS.paymentStatus).toBe('all');
  });
});

describe('SORT_KEY_MAP', () => {
  it('maps name and email directly', () => {
    expect(SORT_KEY_MAP['name']).toBe('name');
    expect(SORT_KEY_MAP['email']).toBe('email');
  });

  it('maps createdAt to created_at', () => {
    expect(SORT_KEY_MAP['createdAt']).toBe('created_at');
  });

  it('maps role, plan, status to id (fallback)', () => {
    expect(SORT_KEY_MAP['role']).toBe('id');
    expect(SORT_KEY_MAP['plan']).toBe('id');
    expect(SORT_KEY_MAP['status']).toBe('id');
  });

  it('maps the analysis columns to their own backend keys', () => {
    expect(SORT_KEY_MAP['lastLogin']).toBe('last_login_at');
    expect(SORT_KEY_MAP['photos']).toBe('photos');
    expect(SORT_KEY_MAP['city']).toBe('city');
    expect(SORTABLE_KEYS.has('photos')).toBe(true);
    expect(SORTABLE_KEYS.has('status')).toBe(false);
  });

  it('opens counts and the last sign-in with the most first', () => {
    expect(firstSortDir('photos')).toBe('desc');
    expect(firstSortDir('lastLogin')).toBe('desc');
    expect(firstSortDir('name')).toBe('asc');
    expect(firstSortDir('city')).toBe('asc');
    expect(
      nextSort({ sortKey: 'createdAt', sortDir: 'desc' }, 'photos')
    ).toEqual({ sortKey: 'photos', sortDir: 'desc' });
    expect(nextSort({ sortKey: 'photos', sortDir: 'desc' }, 'photos')).toEqual({
      sortKey: 'photos',
      sortDir: 'asc',
    });
  });
});

// ─── buildRequest ─────────────────────────────────────────────────────────────

function baseFilters(overrides: Partial<FilterState> = {}): FilterState {
  return { ...INITIAL_FILTERS, ...overrides };
}

describe('buildRequest', () => {
  it('always includes take = PAGE_SIZE', () => {
    const req = buildRequest(baseFilters(), undefined, 'name', 'asc');
    expect(req.take).toBe(PAGE_SIZE);
  });

  it('includes sort_order from sortDir', () => {
    expect(
      buildRequest(baseFilters(), undefined, 'name', 'asc').sort_order
    ).toBe('asc');
    expect(
      buildRequest(baseFilters(), undefined, 'name', 'desc').sort_order
    ).toBe('desc');
  });

  it('includes cursor when provided', () => {
    const req = buildRequest(baseFilters(), 'cursor-123', 'name', 'asc');
    expect(req.cursor).toBe('cursor-123');
  });

  it('omits cursor when undefined', () => {
    const req = buildRequest(baseFilters(), undefined, 'name', 'asc');
    expect('cursor' in req).toBe(false);
  });

  it('includes sort_by from SORT_KEY_MAP', () => {
    const req = buildRequest(baseFilters(), undefined, 'email', 'asc');
    expect(req.sort_by).toBe('email');
  });

  it('maps createdAt sortKey to created_at in sort_by', () => {
    const req = buildRequest(baseFilters(), undefined, 'createdAt', 'asc');
    expect(req.sort_by).toBe('created_at');
  });

  it('includes trimmed search when non-empty', () => {
    const req = buildRequest(
      baseFilters({ search: '  anna  ' }),
      undefined,
      'name',
      'asc'
    );
    expect(req.search).toBe('anna');
  });

  it('omits search when empty string', () => {
    const req = buildRequest(
      baseFilters({ search: '' }),
      undefined,
      'name',
      'asc'
    );
    expect('search' in req).toBe(false);
  });

  it('omits search when only whitespace', () => {
    const req = buildRequest(
      baseFilters({ search: '   ' }),
      undefined,
      'name',
      'asc'
    );
    expect('search' in req).toBe(false);
  });

  it('includes role when not "all"', () => {
    const req = buildRequest(
      baseFilters({ role: 'STYLIST' }),
      undefined,
      'name',
      'asc'
    );
    expect(req.role).toBe('STYLIST');
  });

  it('omits role when "all"', () => {
    const req = buildRequest(
      baseFilters({ role: 'all' }),
      undefined,
      'name',
      'asc'
    );
    expect('role' in req).toBe(false);
  });

  it('includes pricing_plan when plan is not "all"', () => {
    const req = buildRequest(
      baseFilters({ plan: 'PRO' }),
      undefined,
      'name',
      'asc'
    );
    expect(req.pricing_plan).toBe('PRO');
  });

  it('omits pricing_plan when plan is "all"', () => {
    const req = buildRequest(
      baseFilters({ plan: 'all' }),
      undefined,
      'name',
      'asc'
    );
    expect('pricing_plan' in req).toBe(false);
  });

  it('includes account_status when not "all"', () => {
    const req = buildRequest(
      baseFilters({ accountStatus: 'ACTIVE' }),
      undefined,
      'name',
      'asc'
    );
    expect(req.account_status).toBe('ACTIVE');
  });

  it('omits account_status when "all"', () => {
    const req = buildRequest(
      baseFilters({ accountStatus: 'all' }),
      undefined,
      'name',
      'asc'
    );
    expect('account_status' in req).toBe(false);
  });

  it('includes payment_status when not "all"', () => {
    const req = buildRequest(
      baseFilters({ paymentStatus: 'PAID' }),
      undefined,
      'name',
      'asc'
    );
    expect(req.payment_status).toBe('PAID');
  });

  it('omits payment_status when "all"', () => {
    const req = buildRequest(
      baseFilters({ paymentStatus: 'all' }),
      undefined,
      'name',
      'asc'
    );
    expect('payment_status' in req).toBe(false);
  });

  it('builds minimal request with all defaults', () => {
    const req = buildRequest(INITIAL_FILTERS, undefined, 'name', 'asc');
    expect(req).toEqual({
      take: PAGE_SIZE,
      sort_order: 'asc',
      sort_by: 'name',
    });
  });

  it('builds fully populated request', () => {
    const filters: FilterState = {
      search: 'test',
      role: 'CLIENT',
      plan: 'PRO',
      accountStatus: 'NOT_ACTIVE',
      paymentStatus: 'REJECTED',
    };
    const req = buildRequest(filters, 'cursor-abc', 'email', 'desc');
    expect(req.take).toBe(PAGE_SIZE);
    expect(req.sort_order).toBe('desc');
    expect(req.sort_by).toBe('email');
    expect(req.cursor).toBe('cursor-abc');
    expect(req.search).toBe('test');
    expect(req.role).toBe('CLIENT');
    expect(req.pricing_plan).toBe('PRO');
    expect(req.account_status).toBe('NOT_ACTIVE');
    expect(req.payment_status).toBe('REJECTED');
  });
});

// ─── URL state ────────────────────────────────────────────────────────────────

describe('admin users URL state', () => {
  it('parses an empty query to defaults and builds it back to an empty query', () => {
    const state = parseAdminUsersQuery({});
    expect(state.filters).toEqual(INITIAL_FILTERS);
    expect(state.sortKey).toBe(DEFAULT_SORT_KEY);
    expect(state.sortDir).toBe(DEFAULT_SORT_DIR);
    expect(state.userId).toBeNull();
    expect(buildAdminUsersQuery(state)).toEqual({});
  });

  it('round-trips filters, sort and the open user', () => {
    const query = {
      q: 'anna',
      role: 'STYLIST',
      plan: 'PRO',
      status: 'ACTIVE',
      payment: 'PAID',
      sort: 'email',
      dir: 'asc',
      user: 'user-1',
    };
    expect(buildAdminUsersQuery(parseAdminUsersQuery(query))).toEqual(query);
  });

  it('drops values that are not part of the contract', () => {
    const state = parseAdminUsersQuery({
      role: 'HACKER',
      plan: 'FREEEE',
      sort: 'status',
      dir: 'sideways',
      user: '   ',
    });
    expect(state.filters.role).toBe('all');
    expect(state.filters.plan).toBe('all');
    expect(state.sortKey).toBe(DEFAULT_SORT_KEY);
    expect(state.sortDir).toBe(DEFAULT_SORT_DIR);
    expect(state.userId).toBeNull();
  });

  it('reads the first value of a repeated param', () => {
    expect(parseAdminUsersQuery({ q: ['a', 'b'] }).filters.search).toBe('a');
  });
});

describe('admin user display labels', () => {
  it('maps stylist, client and admin to locale keys', () => {
    expect(
      adminUserRoleLabelKey({
        account_type: AccountTypeValue.STYLIST,
        role_id: SystemRoleId.STYLIST_ROLE,
        onboarding_completed: true,
      })
    ).toBe('roleStylist');
    expect(
      adminUserRoleLabelKey({
        account_type: AccountTypeValue.CLIENT,
        role_id: SystemRoleId.CLIENT_ROLE,
        onboarding_completed: true,
      })
    ).toBe('roleClient');
    expect(
      adminUserRoleLabelKey({
        account_type: AccountTypeValue.STYLIST,
        role_id: SystemRoleId.MASTER_ADMIN,
        onboarding_completed: false,
      })
    ).toBe('roleAdmin');
  });

  it('does not call a user who never picked a role a client', () => {
    expect(
      adminUserRoleLabelKey({
        account_type: AccountTypeValue.CLIENT,
        role_id: SystemRoleId.CLIENT_ROLE,
        onboarding_completed: false,
      })
    ).toBe('roleOnboardingPending');
  });

  it('uses the empty label for a blank name and keeps a real name', () => {
    expect(adminUserDisplayName('', 'Bez nazwy')).toBe('Bez nazwy');
    expect(adminUserDisplayName('   ', 'Bez nazwy')).toBe('Bez nazwy');
    expect(adminUserDisplayName('Anna', 'Bez nazwy')).toBe('Anna');
  });
});

describe('no-role filter', () => {
  it('round-trips through the URL and asks the API for pending onboarding', () => {
    const state = parseAdminUsersQuery({ role: ROLE_FILTER_NO_ROLE });
    expect(state.filters.role).toBe(ROLE_FILTER_NO_ROLE);
    const request = buildRequest(state.filters, undefined, 'createdAt', 'desc');
    expect(request.onboarding_pending).toBe(true);
    expect(request.role).toBeUndefined();
  });
});

describe('kernel link contract round-trips through the list codec', () => {
  const queryOf = (href: string) =>
    Object.fromEntries(new URL(href, 'https://example.test').searchParams);

  it('a person link opens the list narrowed to them with the card open', () => {
    const state = parseAdminUsersQuery(
      queryOf(adminUserHref({ search: 'anna@example.test', userId: 'u1' }))
    );
    expect(state.filters.search).toBe('anna@example.test');
    expect(state.userId).toBe('u1');
  });

  it('the no-role link selects the onboarding-pending filter', () => {
    const state = parseAdminUsersQuery(queryOf(adminUsersWithoutRoleHref()));
    expect(state.filters.role).toBe(ROLE_FILTER_NO_ROLE);
  });

  it('the badge links select the attention list and build the same URL back', () => {
    const payments = parseAdminUsersQuery(
      queryOf(adminUsersPaymentsAttentionHref())
    );
    expect(payments.attention).toBe('payments');
    expect(
      buildRequest(payments.filters, undefined, 'createdAt', 'desc', payments)
        .attention
    ).toBe('payments');
    expect(buildAdminUsersQuery(payments)).toEqual(
      queryOf(adminUsersPaymentsAttentionHref())
    );
    expect(parseAdminUsersQuery(queryOf(adminUsersStuckHref())).attention).toBe(
      'stuck'
    );
    expect(
      parseAdminUsersQuery({ attention: 'everything' }).attention
    ).toBeNull();
  });
});

describe('dashboard tile links open the list with the counter query', () => {
  const queryOf = (href: string) =>
    Object.fromEntries(new URL(href, 'https://example.test').searchParams);

  it('new accounts: the window start day goes to created_from', () => {
    const day = adminNewUsersWindowStartDay(
      new Date('2026-10-17T23:59:00.000Z'),
      7
    );
    expect(day).toBe('2026-10-10');
    const state = parseAdminUsersQuery(
      queryOf(adminUsersRegisteredFromHref(day))
    );
    expect(state.registeredFrom).toBe('2026-10-10');
    expect(
      buildRequest(state.filters, undefined, 'createdAt', 'desc', state)
        .created_from
    ).toBe('2026-10-10');
    expect(buildAdminUsersQuery(state)).toEqual(
      queryOf(adminUsersRegisteredFromHref(day))
    );
  });

  it('new accounts: a day that is not a calendar day is dropped', () => {
    expect(parseAdminUsersQuery({ from: '2026-02-30' }).registeredFrom).toBe(
      null
    );
    expect(parseAdminUsersQuery({ from: 'yesterday' }).registeredFrom).toBe(
      null
    );
  });

  it('blocked accounts: asks the API for is_active = false', () => {
    const state = parseAdminUsersQuery(queryOf(adminUsersBlockedHref()));
    expect(state.blocked).toBe(true);
    expect(
      buildRequest(state.filters, undefined, 'createdAt', 'desc', state)
        .is_active
    ).toBe(false);
    expect(buildAdminUsersQuery(state)).toEqual(
      queryOf(adminUsersBlockedHref())
    );
    expect(parseAdminUsersQuery({ blocked: 'yes' }).blocked).toBe(false);
  });
});
