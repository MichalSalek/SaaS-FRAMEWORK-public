/**
 * Salon staff handlers bound through `bindEndpoint` / `defineEndpoint`.
 * An invite without an email is 400. A missing staffId on get-by-id stays a
 * validation failure and never reaches the operation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import staffHandler from '../../pages/api/v1/salon/staff/index';
import byIdHandler from '../../pages/api/v1/salon/staff/[staffId]/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';

const ops = vi.hoisted(() => ({
  invite: vi.fn(),
  list: vi.fn(),
  byId: vi.fn(),
}));

vi.mock(
  '@domain/salon-staff/operations/salon-staff-management.operations',
  () => ({
    inviteStaffMember_IO: ops.invite,
    removeStaffMember_IO: vi.fn(),
    updateStaffPermissions_IO: vi.fn(),
  })
);
vi.mock('@domain/salon-staff/operations/salon-staff-query.operations', () => ({
  getAllStaffMembers_IO: ops.list,
  getStaffMemberById_IO: ops.byId,
}));
vi.mock('@domain/salon-staff/salon-staff-invite-notification.service', () => ({
  sendStaffInvitationNotification: vi.fn(),
}));
vi.mock('@app/feature-flags/feature-flags.guard', () => ({
  requireSalonStaffEnabled: vi.fn(async () => true),
}));

describe('salon staff through the API contract', () => {
  beforeEach(() => {
    ops.invite.mockReset();
    ops.list.mockReset();
    ops.byId.mockReset();
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    __setPermission(true);
    mockDb({ impersonationBackup: { findFirst: async () => null } });
  });

  it('invite: a body without an email is 400 and never reaches the operation', async () => {
    const { status, event } = await mockApiHandler(staffHandler, {
      method: 'POST',
      body: { role: 'EMPLOYEE' },
    });
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(ops.invite).not.toHaveBeenCalled();
  });

  it('get-by-id: a missing staffId is a validation failure', async () => {
    const { status, event } = await mockApiHandler(byIdHandler, {
      method: 'GET',
      query: {},
    });
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(ops.byId).not.toHaveBeenCalled();
  });
});
