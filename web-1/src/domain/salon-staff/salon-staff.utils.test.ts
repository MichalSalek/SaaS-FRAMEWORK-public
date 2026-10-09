/**
 * mapStaffMemberToDTO — D1 phantom-seat mask.
 *
 * Mask is keyed off User.is_active === false. Absent is_active is treated as
 * live (the mapper does not guess). A membership that was never accepted
 * (accepted_at === null) hides name + image but keeps the typed e-mail, and
 * exposes accepted_at so the owner's roster can show the pending state.
 */

import { describe, it, expect } from 'vitest';
import { mapStaffMemberToDTO, resolveInviterName } from './salon-staff.utils';
import { StaffRoleValue } from '@kernel/models/db_models.generated.dto';

const INVITED_AT = new Date('2026-08-01T10:00:00.000Z');
const ACCEPTED_AT = new Date('2026-08-02T10:00:00.000Z');

const baseStaff = {
  id: 'stf_test_0000000000000001',
  stylist_account_id: 'sa_test_0000000000000001',
  user_id: 'usr_staff_00000000000001',
  role: StaffRoleValue.EMPLOYEE,
  permissions: ['GALLERY_VIEW'] as const,
  is_active: true,
  invited_at: INVITED_AT,
  accepted_at: ACCEPTED_AT as Date | null,
};

const liveUser = {
  id: 'usr_staff_00000000000001',
  name: 'Ala',
  email: 'ala@example.com',
  image: 'https://cdn.example/ala.jpg',
};

describe('mapStaffMemberToDTO — D1 user_inactive mask', () => {
  it('user.is_active:false → user_inactive:true and name/email/image masked', () => {
    const dto = mapStaffMemberToDTO({
      ...baseStaff,
      permissions: [...baseStaff.permissions],
      user: { ...liveUser, is_active: false },
    });

    expect(dto).toEqual({
      id: baseStaff.id,
      stylist_account_id: baseStaff.stylist_account_id,
      user_id: baseStaff.user_id,
      role: StaffRoleValue.EMPLOYEE,
      permissions: ['GALLERY_VIEW'],
      is_active: true,
      created_at: INVITED_AT.toISOString(),
      user_inactive: true,
      accepted_at: ACCEPTED_AT.toISOString(),
      user: {
        id: liveUser.id,
        name: null,
        email: '',
        image: null,
      },
    });
  });

  it('user.is_active:true → user_inactive:false and PII untouched', () => {
    const dto = mapStaffMemberToDTO({
      ...baseStaff,
      permissions: [...baseStaff.permissions],
      user: { ...liveUser, is_active: true },
    });

    expect(dto.user_inactive).toBe(false);
    expect(dto.user).toEqual(liveUser);
  });

  it('user.is_active absent → user_inactive:false and PII untouched', () => {
    const dto = mapStaffMemberToDTO({
      ...baseStaff,
      permissions: [...baseStaff.permissions],
      user: liveUser,
    });

    expect(dto.user_inactive).toBe(false);
    expect(dto.user).toEqual(liveUser);
  });
});

describe('mapStaffMemberToDTO — pending invite identity mask', () => {
  it('accepted_at:null → name/image hidden, typed e-mail kept', () => {
    const dto = mapStaffMemberToDTO({
      ...baseStaff,
      accepted_at: null,
      permissions: [...baseStaff.permissions],
      user: { ...liveUser, is_active: true },
    });

    expect(dto.user_inactive).toBe(false);
    // The owner's roster reads this as „oczekuje na akceptację”.
    expect(dto.accepted_at).toBeNull();
    expect(dto.user).toEqual({
      id: liveUser.id,
      name: null,
      email: liveUser.email,
      image: null,
    });
  });

  it('accepted_at set → identity revealed and accepted_at on the wire as ISO', () => {
    const dto = mapStaffMemberToDTO({
      ...baseStaff,
      permissions: [...baseStaff.permissions],
      user: { ...liveUser, is_active: true },
    });

    expect(dto.accepted_at).toBe(ACCEPTED_AT.toISOString());
    expect(dto.user?.name).toBe(liveUser.name);
    expect(dto.user?.image).toBe(liveUser.image);
  });

  it('accepted_at:null on a dead account → full D1 mask still wins', () => {
    const dto = mapStaffMemberToDTO({
      ...baseStaff,
      accepted_at: null,
      permissions: [...baseStaff.permissions],
      user: { ...liveUser, is_active: false },
    });

    expect(dto.user_inactive).toBe(true);
    expect(dto.user).toEqual({
      id: liveUser.id,
      name: null,
      email: '',
      image: null,
    });
  });
});

describe('resolveInviterName', () => {
  const salon = (
    display_name: string | null,
    ownerName: string | null,
    business_name: string | null
  ) => ({
    display_name,
    business_name,
    created_by_user: { name: ownerName },
  });

  it('prefers display_name, then the owner name, then business_name', () => {
    expect(resolveInviterName(salon('Ola Nails', 'Ola', 'Studio O'))).toBe(
      'Ola Nails'
    );
    expect(resolveInviterName(salon('  ', 'Ola', 'Studio O'))).toBe('Ola');
    expect(resolveInviterName(salon(null, null, 'Studio O'))).toBe('Studio O');
  });

  it('returns an empty string when nothing is set', () => {
    expect(resolveInviterName(salon(null, ' ', null))).toBe('');
    expect(
      resolveInviterName({
        display_name: null,
        business_name: null,
        created_by_user: null,
      })
    ).toBe('');
  });
});
