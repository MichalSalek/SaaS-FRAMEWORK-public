/**
 * Salon Staff domain smoke tests
 *
 * Covers: SALON_STAFF_PERMISSIONS_VERIFY, SALON_STAFF_LIST_OPEN_ON_FREE_PLAN,
 * SALON_STAFF_INVITE_BLOCKED_ON_FREE_PLAN
 */

import { test, apiCall, getData, getEvent, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { RoleValue } from '@kernel/models/db_models.manual.dto';
import type { EVENT_COMMANDS_AND_QUERIES_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';

export async function runSalonStaffTests(ctx: TestContext): Promise<void> {
  await test('SALON_STAFF_PERMISSIONS_VERIFY', async () => {
    // VERIFY that SALON_STAFF permissions exist on STYLIST_ROLE
    // This is a read-only check -- seeding is done in instrumentation.ts
    const permissionsResponse = await apiCall({
      endpoint: '/api/v1/admin/permissions',
      method: 'GET',
      token: ctx.adminToken,
    });
    assert.status(permissionsResponse, 200);

    const data =
      getData<ADMIN_DTO_API_V1['ADMIN_GET_PERMISSIONS']['RESPONSE']>(
        permissionsResponse
      );
    const roles = data?.roles ?? [];
    const stylistRole = roles.find(
      role => role.name === RoleValue.STYLIST_ROLE
    );
    if (!stylistRole) {
      throw new Error('Stylist role not found in permissions response');
    }

    const currentEventNames = new Set(
      (stylistRole.permissions ?? []).map(entry => entry.permission.event_name)
    );

    const requiredEvents: EVENT_COMMANDS_AND_QUERIES_TYPE[] = [
      'SALON_STAFF_INVITE',
      'SALON_STAFF_REMOVE',
      'SALON_STAFF_UPDATE_PERMISSIONS',
      'SALON_STAFF_GET_ALL',
      'SALON_STAFF_GET_BY_ID',
    ];

    const missingEvents = requiredEvents.filter(
      eventName => !currentEventNames.has(eventName)
    );

    if (missingEvents.length > 0) {
      throw new Error(
        `Missing SALON_STAFF permissions on STYLIST_ROLE: ${missingEvents.join(', ')}. ` +
          `These should be seeded by instrumentation.ts on startup.`
      );
    }
  });

  await test('SALON_STAFF_LIST_OPEN_ON_FREE_PLAN', async () => {
    // The default stylist test user (STYLIST_MAIN) is on the FREE plan.
    // GET staff list is capacity-NEUTRAL and is NOT plan-gated: it is read-only,
    // scoped to the caller's own salon, and a downgraded STUDIO/SCALE owner must
    // still be able to DISCOVER orphan staff rows in order to remove them
    // (getAllStaffMembers_IO deliberately dropped its plan-gate — see the DECISION
    // comment in salon-staff-query.operations.ts). Correct behavior on FREE is
    // therefore 200 with an empty staff list, NOT 403.
    const response = await apiCall({
      endpoint: '/api/v1/salon/staff',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(
      response,
      200,
      'FREE plan GET staff list is capacity-neutral → 200'
    );
    const data = getData<{ staff: unknown[] }>(response);
    if (!Array.isArray(data?.staff)) {
      throw new Error(
        `Expected { staff: [] } body, got: ${JSON.stringify(response.body).slice(0, 200)}`
      );
    }
    // STYLIST_MAIN owns no staff (smoke pre-clean wipes their content) → list is empty.
    assert.equals(
      data.staff.length,
      0,
      'FREE plan stylist should have an empty staff list'
    );
  });

  await test('SALON_STAFF_INVITE_BLOCKED_ON_FREE_PLAN', async () => {
    // The REAL plan gate lives on the mutation: inviteStaffMember_IO rejects any
    // invite when canUseStaffAccounts(plan) is false. On FREE this short-circuits
    // BEFORE any invitee lookup, so a never-registered email still yields the plan
    // rejection (not a 404/400). Pricing guard returns 403 via
    // SALON_STAFF_LIMIT_REACHED → respondPlanLimitReached (PLAN_LIMIT_REACHED_INFO).
    const response = await apiCall({
      endpoint: '/api/v1/salon/staff',
      method: 'POST',
      token: ctx.stylistToken,
      body: {
        email: `temp-qa-salon-staff-smoke-${Date.now()}@example.com`,
        role: 'EMPLOYEE',
      },
    });
    assert.status(
      response,
      403,
      'FREE plan should block staff INVITE (plan limit reached)'
    );
    // Verify body semantics, not just status: the discriminating event must be the
    // shared plan-limit signal, confirming the 403 is the pricing gate (not RBAC/auth).
    assert.equals(
      getEvent(response),
      'PLAN_LIMIT_REACHED_INFO',
      'Invite block on FREE must map to the plan-limit event'
    );
  });
}
