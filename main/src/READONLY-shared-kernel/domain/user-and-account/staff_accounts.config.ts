export const STAFF_ROLES = ['OWNER', 'MANAGER', 'EMPLOYEE'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** The invited stylist's answer to a salon-team invitation (SALON_STAFF_RESPOND_INVITATION). */
export const STAFF_INVITATION_RESPONSES = ['ACCEPT', 'DECLINE'] as const;
export type StaffInvitationResponse =
  (typeof STAFF_INVITATION_RESPONSES)[number];

const STAFF_ROLES_SET: ReadonlySet<string> = new Set(STAFF_ROLES);

export const STAFF_PERMISSIONS = [
  'GALLERY_VIEW',
  'GALLERY_EDIT',
  'PAIRING_MANAGE',
  'SESSION_SHARE_RECEIVE',
] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

export const DEFAULT_PERMISSIONS_BY_ROLE: Record<
  StaffRole,
  readonly StaffPermission[]
> = {
  OWNER: STAFF_PERMISSIONS,
  MANAGER: [
    'GALLERY_VIEW',
    'GALLERY_EDIT',
    'PAIRING_MANAGE',
    'SESSION_SHARE_RECEIVE',
  ],
  EMPLOYEE: ['GALLERY_VIEW', 'SESSION_SHARE_RECEIVE'],
} as const;

export const hasStaffPermission = (
  staffPermissions: readonly StaffPermission[],
  required: StaffPermission
): boolean => {
  return staffPermissions.includes(required);
};

export const isValidStaffRole = (value: unknown): value is StaffRole => {
  return typeof value === 'string' && STAFF_ROLES_SET.has(value);
};
