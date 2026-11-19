import {
  contractEndpoint,
  contractPathEndpoint,
} from '../../application/http/io';
import { SALON_STAFF_CONTRACTS } from '@kernel/domain/salon-staff/salon-staff.contracts';

export const getSalonStaff_IO = contractEndpoint(
  SALON_STAFF_CONTRACTS.SALON_STAFF_GET_ALL
);

export const inviteSalonStaff_IO = contractEndpoint(
  SALON_STAFF_CONTRACTS.SALON_STAFF_INVITE
);

export const getMySalonInvitations_IO = contractEndpoint(
  SALON_STAFF_CONTRACTS.SALON_STAFF_GET_MY_INVITATIONS
);

export const respondSalonInvitation_IO = contractEndpoint(
  SALON_STAFF_CONTRACTS.SALON_STAFF_RESPOND_INVITATION
);

export const updateSalonStaffPermissions_IO = (staffId: string) =>
  contractPathEndpoint(SALON_STAFF_CONTRACTS.SALON_STAFF_UPDATE_PERMISSIONS)({
    staffId,
  });

export const removeSalonStaff_IO = (staffId: string) =>
  contractPathEndpoint(SALON_STAFF_CONTRACTS.SALON_STAFF_REMOVE)({ staffId });

export const getSalonStaffById_IO = (staffId: string) =>
  contractPathEndpoint(SALON_STAFF_CONTRACTS.SALON_STAFF_GET_BY_ID)({
    staffId,
  });

export const getMySalonTeam_IO = contractEndpoint(
  SALON_STAFF_CONTRACTS.SALON_STAFF_GET_MY_TEAM
);

export const leaveSalonTeam_IO = contractEndpoint(
  SALON_STAFF_CONTRACTS.SALON_STAFF_LEAVE_TEAM
);

export const acceptSalonInvitationToken_IO = contractEndpoint(
  SALON_STAFF_CONTRACTS.SALON_STAFF_ACCEPT_TOKEN
);
