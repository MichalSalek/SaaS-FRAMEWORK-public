import { z } from 'zod';
import { wireInstant } from '../../application/contracts/wire-values';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import {
  STAFF_INVITATION_RESPONSES,
  STAFF_PERMISSIONS,
  STAFF_ROLES,
  type StaffPermission,
} from '../user-and-account/staff_accounts.config';
import { VALIDATION_LENGTHS } from '../../policies/validation.config';
import { validateEmail } from '../../policies/validation/validation.utils';

const V = VALIDATION_MESSAGES;

// DECISION: invite accepts ONLY the EMPLOYEE role server-side, although StaffRole has
// OWNER/MANAGER/EMPLOYEE. OWNER is never invitable: a salon has exactly one owner (its creator,
// StylistAccount.created_by_user_id) and a second one would get DEFAULT_PERMISSIONS_BY_ROLE.OWNER = all
// permissions. MANAGER is withheld until the UI offers a role picker (today it only sends EMPLOYEE).
// Accepting any isValidStaffRole let a crafted POST self-grant elevated default permissions. The gate
// is the validator so every caller is constrained; `z.literal('EMPLOYEE')` fails every other value
// (OWNER/MANAGER/''/null/undefined -> role.staffRoleRequired). Widen the day the UI supports MANAGER.
export const salonStaffInviteSchema = z.object({
  email: z
    .string({ error: V.email.invalid })
    .refine(value => validateEmail(value), V.email.invalid),
  role: z.literal('EMPLOYEE', { error: V.role.staffRoleRequired }),
});

export const salonStaffAcceptTokenSchema = z.object({
  token: z
    .string({ error: V.general.fieldRequired })
    .regex(/^[A-Za-z0-9_-]{43}$/, V.general.fieldRequired),
  response: z
    .enum(['ACCEPT', 'DECLINE'], { error: V.general.fieldRequired })
    .optional(),
});

export const salonStaffLeaveTeamSchema = z.object({
  salon_account_id: z
    .string({ error: V.general.fieldRequired })
    .min(1, V.general.fieldRequired)
    .max(VALIDATION_LENGTHS.ENTITY_ID_MAX, V.general.fieldRequired),
});

export const salonStaffRespondInvitationSchema = z.object({
  staff_member_id: z
    .string({ error: V.general.fieldRequired })
    .min(1, V.general.fieldRequired)
    .max(VALIDATION_LENGTHS.ENTITY_ID_MAX, V.general.fieldRequired),
  response: z.enum(STAFF_INVITATION_RESPONSES, {
    error: V.general.fieldRequired,
  }),
});

// DECISION: the update path rejects any `role`, same as invite. The UI sends only `permissions`;
// `{ role: 'OWNER' }` escalated an employee into an unremovable card (one OWNER, created_by_user_id).
// Widen only with a real role picker and a server ceiling. Schemas are `z.custom` carriers;
// superRefine is the only gate (one issue per field). `zodValidate` still reads slots from `schema.shape`.
export const salonStaffUpdateSchema = z
  .object({
    role: z.custom<null>().optional(),
    permissions: z.custom<StaffPermission[]>().optional(),
  })
  .superRefine((data, ctx) => {
    const { role, permissions } = data;

    if (role !== undefined && role !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['role'],
        message: V.role.staffRoleRequired,
      });
    }

    if (permissions !== undefined && permissions !== null) {
      if (!Array.isArray(permissions)) {
        ctx.addIssue({
          code: 'custom',
          path: ['permissions'],
          message: V.role.permissionsRequired,
        });
      } else {
        const invalidPermission = permissions.find(permission => {
          if (typeof permission !== 'string') {
            return true;
          }
          return !STAFF_PERMISSIONS.includes(
            permission as (typeof STAFF_PERMISSIONS)[number]
          );
        });

        if (invalidPermission !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['permissions'],
            message: V.role.permissionsRequired,
          });
        }
      }
    }

    if (
      (role === undefined || role === null) &&
      (permissions === undefined || permissions === null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: V.general.fieldRequired,
      });
    }
  });

export const salonStaffRemoveSchema = z.object({});

const staffUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  name: z.string().nullable(),
});

export const staffMemberSchema = z.object({
  id: z.string(),
  stylist_account_id: z.string(),
  // StaffMember.user_id is a required column. An unattached invitation card uses ''.
  user_id: z.string(),
  role: z.enum(STAFF_ROLES),
  is_active: z.boolean(),
  public_profile_id: z.string().optional(),
  contributes_to_gallery: z.boolean().optional(),
  awaiting_stylist_account: z.boolean().optional(),
  permissions: z.array(z.enum(STAFF_PERMISSIONS)),
  created_at: wireInstant,
  user: staffUserSchema.optional(),
  user_inactive: z.boolean(),
  accepted_at: wireInstant.nullable(),
});

export const staffMemberResponseSchema = z.object({
  staff: staffMemberSchema,
});

export const staffListResponseSchema = z.object({
  staff: z.array(staffMemberSchema),
});

export const staffRemovedSchema = z.object({ success: z.boolean() });

export const staffInvitationSchema = z.object({
  staff_member_id: z.string(),
  salon_account_id: z.string(),
  inviter_name: z.string(),
  salon_name: z.string().nullable(),
  owner_avatar_url: z.string().nullable(),
  role: z.enum(STAFF_ROLES),
  invited_at: wireInstant,
});

export const staffInvitationsResponseSchema = z.object({
  invitations: z.array(staffInvitationSchema),
});

export const staffInvitationAnswerSchema = z.object({
  staff_member_id: z.string(),
  status: z.enum(['ACCEPTED', 'DECLINED']),
  accepted_at: wireInstant.nullable(),
});

export const staffAcceptTokenResponseSchema = z.object({
  status: z.enum(['ACCEPTED', 'DECLINED']),
  email: z.string(),
  salon_name: z.string(),
  requires_stylist_account: z.boolean(),
});

const teamPersonSchema = z.object({
  user_id: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
  public_profile_id: z.string().nullable(),
});

export const salonTeamResponseSchema = z.object({
  teams: z.array(
    z.object({
      salon_account_id: z.string(),
      salon_name: z.string(),
      gallery_available: z.boolean().optional(),
      owner: teamPersonSchema,
      members: z.array(
        teamPersonSchema.extend({
          staff_member_id: z.string(),
          role: z.enum(STAFF_ROLES),
        })
      ),
    })
  ),
  awaiting_stylist_salon_names: z.array(z.string()).optional(),
});
