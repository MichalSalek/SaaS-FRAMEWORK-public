import type { SalonInvitation } from '@kernel/models/db_models.generated.dto';
import type { StaffMemberDTO } from '@kernel/models/salon-staff/salon-staff.dto';
export const invitationToStaffDTO = (row: SalonInvitation): StaffMemberDTO => ({
  id: row.id,
  stylist_account_id: row.salon_account_id,
  user_id: '',
  role: row.role,
  permissions: [],
  is_active: row.declined_at === null,
  created_at: row.created_at.toISOString(),
  accepted_at: row.accepted_at?.toISOString() ?? null,
  awaiting_stylist_account: row.accepted_at !== null,
  user_inactive: false,
  user: { id: '', email: row.email, name: null, image: null },
});
