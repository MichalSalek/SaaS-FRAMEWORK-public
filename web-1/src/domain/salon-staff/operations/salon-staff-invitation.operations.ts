import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { SalonStaffNotFoundError } from '@kernel/domain/salon-staff/salon-staff-errors.types';
import type { StaffInvitationResponse } from '@kernel/domain/user-and-account/staff_accounts.config';
import type {
  SALON_STAFF_DTO_API_V1,
  StaffInvitationDTO,
} from '@kernel/models/salon-staff/salon-staff.dto';
import type { Prisma } from '../../../prisma/js-client';
import { resolveInviterName } from '@domain/salon-staff/salon-staff.utils';

// `applied` = this request changed state (not a replay or a foreign no-op); the
// handler audits only then, so the trail records decisions, not clicks.
type RespondResult =
  SALON_STAFF_DTO_API_V1['SALON_STAFF_RESPOND_INVITATION']['RESPONSE'] & {
    applied: boolean;
  };

// DECISION (nie usuwaj tego komentarza) — ZAPROSZENIE WIDAĆ TYLKO OD ŻYWEGO SALONU:
// ban i samodzielne usunięcie konta właścicielki NIE kasują wierszy StaffMember (patrz
// DECISION na górze salon-staff-management.operations.ts), więc bez tego warunku zaproszona
// stylistka widziałaby i mogła przyjąć zaproszenie od salonu, którego nie ma. Oba zdarzenia
// zamrażają User właścicielki (is_active=false; ban admina dodatkowo disabled_at), więc to
// jest ten sam sygnał liveness co przy zapraszaniu. Warunek stoi i w liście, i w zapisie
// akceptacji: nie da się przyjąć zaproszenia, którego lista nie pokazuje.
const LIVE_SALON_WHERE: Prisma.StaffMemberWhereInput = {
  stylist_account: {
    created_by_user: { is_active: true, disabled_at: null },
  },
};

/**
 * The caller's own pending salon-team invitations (accepted_at null, membership
 * active, inviting salon alive). Scoped by the session user only.
 */
export const getMyStaffInvitations_IO = async ({
  userId,
}: {
  userId: string;
}): Promise<
  OperationResult<{ invitations: StaffInvitationDTO[] }, DatabaseError>
> => {
  try {
    const rows = await DB_CLIENT.use.staffMember.findMany({
      where: {
        ...LIVE_SALON_WHERE,
        user_id: userId,
        is_active: true,
        accepted_at: null,
      },
      select: {
        id: true,
        stylist_account_id: true,
        role: true,
        invited_at: true,
        stylist_account: {
          select: {
            display_name: true,
            business_name: true,
            avatar_url: true,
            created_by_user: { select: { name: true, image: true } },
          },
        },
      },
      // Oldest first + id tie-break (repo pagination-tiebreaker convention). The
      // per-user list is tiny (one row per salon that invited her), the take is a
      // safety cap, not pagination.
      orderBy: [{ invited_at: 'asc' }, { id: 'asc' }],
      take: 50,
    });

    return success({
      invitations: rows.map(row => ({
        staff_member_id: row.id,
        salon_account_id: row.stylist_account_id,
        inviter_name: resolveInviterName(row.stylist_account),
        salon_name: row.stylist_account.business_name?.trim() || null,
        owner_avatar_url:
          row.stylist_account.avatar_url ??
          row.stylist_account.created_by_user?.image ??
          null,
        role: row.role,
        invited_at: row.invited_at.toISOString(),
      })),
    });
  } catch (error) {
    return databaseFailure('getMyStaffInvitations', error);
  }
};

/**
 * The invited stylist answers her own invitation.
 *
 * ACCEPT writes accepted_at = now (her consent to be listed by name and photo in
 * that salon's team; the roster mask lifts on it). DECLINE removes the membership
 * with the same hard delete an owner removal uses (removeStaffMember_IO), so the
 * seat is freed and the owner may invite her again.
 */
export const respondToStaffInvitation_IO = async ({
  userId,
  staffMemberId,
  response,
}: {
  userId: string;
  staffMemberId: string;
  response: StaffInvitationResponse;
}): Promise<
  OperationResult<RespondResult, SalonStaffNotFoundError | DatabaseError>
> => {
  // DECISION (nie usuwaj tego komentarza) — ODPOWIEDŹ JEST RACE-SAFE I IDEMPOTENTNA:
  // oba zapisy to JEDNO warunkowe zdanie SQL z pełnym predykatem (id + user_id z sesji +
  // accepted_at IS NULL), więc własność i stan sprawdza sam zapis, bez okna TOCTOU między
  // odczytem a zapisem. Dwa urządzenia naraz: Postgres serializuje je na blokadzie wiersza
  // i przegrany ponownie ocenia WHERE po commicie zwycięzcy, więc ACCEPT kontra DECLINE
  // kończy się jednym spójnym stanem, a przegrany dostaje count 0. Dopiero wtedy jeden
  // odczyt rozstrzyga, co znaczy zero:
  //  • ACCEPT, wiersz już zaakceptowany → ten sam sukces (podwójny tap, retry HTTP);
  //  • ACCEPT, wiersza nie ma albo jest cudzy → SALON_STAFF_NOT_FOUND (404, bez wyroczni:
  //    „cudze” i „nie istnieje” wyglądają tak samo);
  //  • DECLINE, wiersza nie ma (już odrzucone albo id cudze) → sukces, parytet z D1 przy
  //    usuwaniu przez właścicielkę: stan docelowy osiągnięty, a cudzy wiersz jest nietknięty,
  //    bo user_id w predykacie pochodzi z sesji;
  //  • DECLINE, członkostwo już zaakceptowane → SALON_STAFF_NOT_FOUND: to nie jest już
  //    zaproszenie, a wyjście z zespołu to osobna decyzja produktowa (dziś robi to
  //    właścicielka przez „Usuń z zespołu”).
  try {
    if (response === 'ACCEPT') {
      const acceptedAt = new Date();
      const updated = await DB_CLIENT.use.staffMember.updateMany({
        where: {
          ...LIVE_SALON_WHERE,
          id: staffMemberId,
          user_id: userId,
          is_active: true,
          accepted_at: null,
        },
        data: { accepted_at: acceptedAt },
      });
      if (updated.count > 0) {
        return success({
          staff_member_id: staffMemberId,
          status: 'ACCEPTED',
          accepted_at: acceptedAt.toISOString(),
          applied: true,
        });
      }
      const existing = await DB_CLIENT.use.staffMember.findFirst({
        where: { id: staffMemberId, user_id: userId, is_active: true },
        select: { accepted_at: true },
      });
      if (existing?.accepted_at) {
        return success({
          staff_member_id: staffMemberId,
          status: 'ACCEPTED',
          accepted_at: existing.accepted_at.toISOString(),
          applied: false,
        });
      }
      return failure({ type: 'SALON_STAFF_NOT_FOUND', staffId: staffMemberId });
    }

    const removed = await DB_CLIENT.use.staffMember.deleteMany({
      where: { id: staffMemberId, user_id: userId, accepted_at: null },
    });
    if (removed.count === 0) {
      const stillMember = await DB_CLIENT.use.staffMember.findFirst({
        where: { id: staffMemberId, user_id: userId },
        select: { id: true },
      });
      if (stillMember) {
        return failure({
          type: 'SALON_STAFF_NOT_FOUND',
          staffId: staffMemberId,
        });
      }
    }
    return success({
      staff_member_id: staffMemberId,
      status: 'DECLINED',
      accepted_at: null,
      applied: removed.count > 0,
    });
  } catch (error) {
    return databaseFailure('respondToStaffInvitation', error);
  }
};
