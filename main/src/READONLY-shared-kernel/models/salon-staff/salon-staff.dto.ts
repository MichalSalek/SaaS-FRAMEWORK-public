import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type {
  StaffInvitationResponse,
  StaffPermission,
  StaffRole,
} from '../../domain/user-and-account/staff_accounts.config';
import type { StaffMember, User } from '../db_models.generated.dto';

export type StaffMemberDTO = Pick<
  StaffMember,
  'id' | 'stylist_account_id' | 'user_id' | 'role' | 'is_active'
> & {
  permissions: StaffPermission[];
  created_at: string; // wire format (maps to StaffMember.invited_at)
  user?: Pick<User, 'id' | 'email' | 'image'> & { name: string | null };
  /** D1 (2026-09-05): konto osoby z zespołu nieaktywne (soft-delete / ban) — miejsce
   *  NADAL zajęte (DECISION w salon-staff.utils.ts), wiersz pokazany jako
   *  „Konto nieaktywne" z ZAMASKOWANĄ tożsamością (user.name/email/image puste)
   *  i akcją „Zwolnij miejsce" (= usunięcie członka). */
  user_inactive: boolean;
  /** Moment the invited stylist accepted (wire ISO string). `null` = the invitation
   *  is still pending: the owner's roster shows „oczekuje na akceptację”, and
   *  `user.name`/`user.image` stay masked until then (DECISION in salon-staff.utils.ts).
   *  The backend always sends it (mapStaffMemberToDTO); the front's isPendingInvite
   *  reads exactly `=== null`. */
  accepted_at: string | null;
};

/**
 * One pending invitation as the INVITEE sees it (SALON_STAFF_GET_MY_INVITATIONS).
 * The salon side is a public stylist profile anyway, so its names and avatar
 * are not a leak; nothing about other team members is included.
 */
export type StaffInvitationDTO = {
  /** StaffMember.id, the key for SALON_STAFF_RESPOND_INVITATION. */
  staff_member_id: string;
  /** The inviting salon's StylistAccount.account_id. */
  salon_account_id: string;
  /** Name shown for the inviting salon: owner's display_name, then her user name, then business_name; '' when none is set. */
  inviter_name: string;
  /** StylistAccount.business_name, when the salon set one. */
  salon_name: string | null;
  /** The owner's avatar (own upload, then the OAuth image), or null. */
  owner_avatar_url: string | null;
  role: StaffRole;
  /** StaffMember.invited_at, wire ISO string. */
  invited_at: string;
};

export type SALON_STAFF_DTO_API_V1 = {
  /** Zaprasza nowego członka zespołu salonu podanym adresem z rolą StaffRole; zwraca utworzony rekord StaffMemberDTO. */
  SALON_STAFF_INVITE: {
    REQUEST: { email: string; role: StaffRole };
    RESPONSE: { staff: StaffMemberDTO };
    RESPONSE_ERROR: DetailedErrorPayload<
      SALON_STAFF_DTO_API_V1['SALON_STAFF_INVITE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SALON_STAFF_DTO_API_V1['SALON_STAFF_INVITE']['REQUEST'],
      SALON_STAFF_DTO_API_V1['SALON_STAFF_INVITE']['RESPONSE'],
      SALON_STAFF_DTO_API_V1['SALON_STAFF_INVITE']['RESPONSE_ERROR']
    >;
  };

  /** Usuwa członka zespołu salonu wskazanego przez staffId w ścieżce; zwraca flagę success. */
  SALON_STAFF_REMOVE: {
    REQUEST: undefined;
    RESPONSE: { success: boolean };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SALON_STAFF_DTO_API_V1['SALON_STAFF_REMOVE']['REQUEST'],
      SALON_STAFF_DTO_API_V1['SALON_STAFF_REMOVE']['RESPONSE'],
      SALON_STAFF_DTO_API_V1['SALON_STAFF_REMOVE']['RESPONSE_ERROR']
    >;
  };

  /** Aktualizuje rolę lub uprawnienia członka zespołu (staffId w ścieżce); zwraca zaktualizowany StaffMemberDTO. */
  SALON_STAFF_UPDATE_PERMISSIONS: {
    REQUEST: { role?: StaffRole; permissions?: StaffPermission[] };
    RESPONSE: { staff: StaffMemberDTO };
    RESPONSE_ERROR: DetailedErrorPayload<
      SALON_STAFF_DTO_API_V1['SALON_STAFF_UPDATE_PERMISSIONS']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SALON_STAFF_DTO_API_V1['SALON_STAFF_UPDATE_PERMISSIONS']['REQUEST'],
      SALON_STAFF_DTO_API_V1['SALON_STAFF_UPDATE_PERMISSIONS']['RESPONSE'],
      SALON_STAFF_DTO_API_V1['SALON_STAFF_UPDATE_PERMISSIONS']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca wszystkich członków zespołu salonu bieżącego konta stylistki; wymaga aktywnej funkcji Salon Staff. */
  SALON_STAFF_GET_ALL: {
    REQUEST: undefined;
    RESPONSE: { staff: StaffMemberDTO[] };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_ALL']['REQUEST'],
      SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_ALL']['RESPONSE'],
      SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_ALL']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca oczekujące zaproszenia do zespołów salonów dla zalogowanej osoby (accepted_at null), najstarsze najpierw. */
  SALON_STAFF_GET_MY_INVITATIONS: {
    REQUEST: undefined;
    RESPONSE: { invitations: StaffInvitationDTO[] };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_MY_INVITATIONS']['REQUEST'],
      SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_MY_INVITATIONS']['RESPONSE'],
      SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_MY_INVITATIONS']['RESPONSE_ERROR']
    >;
  };

  /** Odpowiedź zaproszonej osoby na zaproszenie do zespołu: ACCEPT zapisuje akceptację, DECLINE usuwa członkostwo. */
  SALON_STAFF_RESPOND_INVITATION: {
    REQUEST: { staff_member_id: string; response: StaffInvitationResponse };
    RESPONSE: {
      staff_member_id: string;
      /** ACCEPTED = member of the team (also when it already was), DECLINED = membership removed. */
      status: 'ACCEPTED' | 'DECLINED';
      /** Acceptance moment (wire ISO) for ACCEPTED, null for DECLINED. */
      accepted_at: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      SALON_STAFF_DTO_API_V1['SALON_STAFF_RESPOND_INVITATION']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SALON_STAFF_DTO_API_V1['SALON_STAFF_RESPOND_INVITATION']['REQUEST'],
      SALON_STAFF_DTO_API_V1['SALON_STAFF_RESPOND_INVITATION']['RESPONSE'],
      SALON_STAFF_DTO_API_V1['SALON_STAFF_RESPOND_INVITATION']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca jednego członka zespołu salonu po staffId ze ścieżki, w obrębie konta stylistki. */
  SALON_STAFF_GET_BY_ID: {
    REQUEST: undefined;
    RESPONSE: { staff: StaffMemberDTO };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_BY_ID']['REQUEST'],
      SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_BY_ID']['RESPONSE'],
      SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_BY_ID']['RESPONSE_ERROR']
    >;
  };
};
