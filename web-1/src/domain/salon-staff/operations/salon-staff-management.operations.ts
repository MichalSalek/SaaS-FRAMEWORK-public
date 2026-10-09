import { DB_CLIENT } from '@app/db/db.client';
import { lockStylistAccount } from '@app/db/lock-rows';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { hasCode } from '@kernel/models/type_narrowing';
import type {
  SalonStaffNotFoundError,
  SalonStaffAlreadyExistsError,
  SalonStaffLimitReachedError,
  SalonStaffSelfInviteError,
} from '@kernel/domain/salon-staff/salon-staff-errors.types';
import type { ValidationError } from '@kernel/application/common-errors.types';
import {
  isUnlimitedLimit,
  PRICING_POLICY,
  UNLIMITED_LIMIT,
} from '@kernel/policies/pricing.policy';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import {
  type StaffRole,
  type StaffPermission,
  DEFAULT_PERMISSIONS_BY_ROLE,
} from '@kernel/domain/user-and-account/staff_accounts.config';
import { StaffRoleValue } from '@kernel/models/db_models.generated.dto';
import {
  mapStaffMemberToDTO,
  liveStaffSeatWhere,
} from '@domain/salon-staff/salon-staff.utils';
import type { StaffMemberDTO } from '@kernel/models/salon-staff/salon-staff.dto';

// DECISION (nie usuwaj tego komentarza) — CROSS-DOMAIN INWARIANT (owner-liveness gate,
// jeszcze NIE egzekwowany, bo nie ma czego): dzis StaffMember NIE ma ZADNEGO runtime
// authorization-consumera. Pole `permissions` (GALLERY_EDIT / PAIRING_MANAGE / ...) jest
// przechowywane, ale NIGDZIE nie egzekwowane — kazdy endpoint autoryzuje przez
// requireStylistAccount(currentUser), ktory czyta WYLACZNIE wlasne konto wolajacego, nigdy
// czlonkostwa w salonie. Wiec zaproszony staff faktycznie nie moze dzialac na cudzym salonie
// = zbanowanie/soft-delete wlasciciela nie ma powierzchni do wyciekniecia „staff nadal dziala".
// UWAGA na przyszlosc: gdy pojawi sie sciezka „act-as-staff" nadajaca dostep do salonu na
// podstawie StaffMember.permissions, MUSI ona bramkowac na LIVENESS WLASCICIELA. Ani BAN
// (resolveContentReport_IO), ani softDeleteAccount_IO NIE kasuja/deaktywuja wierszy
// StaffMember (zostaja is_active=true) — oba jednak konsekwentnie zamrazaja wlasciciela
// (StylistAccount.account_status=NOT_ACTIVE + User.is_active=false), wiec sygnal do bramki
// JEST dostepny. Bez tej bramki staff zbanowanego/usunietego salonu dzialalby dalej.
// Akceptacja zaproszenia (accepted_at, respondToStaffInvitation_IO od 2026-09-25) tez NIE
// nadaje zadnego dostepu: to wylacznie zgoda na pokazanie imienia i zdjecia w zespole
// tego salonu. Przyszla sciezka „act-as-staff" powinna wymagac accepted_at != null OBOK
// liveness wlasciciela — zaproszenie bez odpowiedzi nie jest zgoda na prace w salonie.

/**
 * Sentinel rollback error for the inviteStaffMember $transaction.
 *
 * Rzucany z wnętrza Prisma `$transaction`, gdy POST-CREATE recount wykryje, że
 * współbieżny invite przekroczył quotę (finalCount > planLimit). Throw rolluje
 * całą tx (świeży StaffMember cofnięty); zewnętrzny catch mapuje go na
 * SALON_STAFF_LIMIT_REACHED, NIE na DATABASE_ERROR.
 *
 * Typed-class zamiast magic-string sentinela — `instanceof` daje narrowing i nie
 * łapie przypadkowo innego Error o tej samej wiadomości. Wzorzec 1:1 z
 * PairingLimitExceededRollback (pairing-rollback.helper.ts).
 */
class StaffQuotaRaceRollback extends Error {
  constructor() {
    super('Staff quota exceeded by a concurrent invite');
  }
}

export const inviteStaffMember_IO = async ({
  email,
  role,
  accountId,
  pricingPlan,
}: {
  email: string;
  role: StaffRole;
  accountId: string;
  pricingPlan: PricingPlan;
}): Promise<
  OperationResult<
    { staff: StaffMemberDTO },
    | SalonStaffLimitReachedError
    | SalonStaffSelfInviteError
    | SalonStaffAlreadyExistsError
    | ValidationError
    | DatabaseError
  >
> => {
  // DECISION (nie usuwaj tego komentarza):
  // Defense-in-depth role floor — mirrors the salonStaffInvite validator gate
  // (misc.validation.ts). OWNER is NEVER invitable (one owner per salon =
  // StylistAccount.created_by_user_id; a second OWNER would inherit
  // DEFAULT_PERMISSIONS_BY_ROLE.OWNER = all permissions). MANAGER stays withheld
  // until the UI offers a role picker — today the UI only sends EMPLOYEE. This
  // operation is independently callable, so it rejects any non-EMPLOYEE role here
  // too rather than trusting the caller-supplied StaffRole. Widen the day the UI
  // supports choosing MANAGER.
  if (role !== 'EMPLOYEE') {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'role',
      message: 'Only the EMPLOYEE role can be invited',
    });
  }
  // salon-staff-1 fix: emails are stored canonically lowercased (dev-login
  // trim().toLowerCase() + Better Auth signup normalization) and Postgres
  // lookups are case-sensitive. Normalize the inbound email ONCE here to the
  // same canonical form so an owner typing "John.Doe@Gmail.com" resolves the
  // existing "john.doe@gmail.com" account. Used for the user lookup AND every
  // error payload below so the value is consistent end-to-end. The validator
  // only regex-checks (does not mutate), so this is the single normalization
  // point for the read path.
  const normalizedEmail = email.trim().toLowerCase();
  const planConfig = PRICING_POLICY.utils.getPlanConfig(pricingPlan);
  if (!PRICING_POLICY.utils.canUseStaffAccounts(planConfig)) {
    return failure({
      type: 'SALON_STAFF_LIMIT_REACHED',
      currentCount: 0,
      limit: 0,
      planType: pricingPlan,
    });
  }

  // DECISION (nie usuwaj tego komentarza) — cross-user staff-quota race (finding salon-staff-race):
  // PESYMISTYCZNY row-lock (SELECT ... FOR UPDATE) na WSPÓLNYM wierszu StylistAccount,
  // brany JAKO PIERWSZY w tej tx (patrz lock poniżej) — to punkt serializacji całej
  // operacji invite per-konto. Powód: wcześniejszy fix (READ COMMITTED $transaction +
  // pre-count + create + POST-CREATE recount + sentinel-throw) NIE domykał wyścigu.
  // Pod READ COMMITTED N równoległych invite RÓŻNYCH userów do tego samego
  // stylist_account_id NIE kolidowało o żaden wspólny wiersz (każdy create wstawia INNY
  // StaffMember, @@unique([stylist_account_id, user_id]) ich nie serializuje), więc każda
  // tx czytała currentStaffCount < limit, każda tworzyła swój wiersz, a recount widział
  // wciąż PRZED-commitowy snapshot peerów → finalCount = limit + 1 commitował (na STUDIO:
  // limit 5, burst → 6+ staff). To ten sam mechanizm-dziura co gallery-1 (pin-quota) i
  // mod-*-race. FOR UPDATE na StylistAccount serializuje WSZYSTKICH piszących staff tego
  // konta w JEDNEJ kolejności: przegrany CZEKA na locku, a po commicie zwycięzcy czyta
  // JUŻ skommitowany currentStaffCount i pre-check go odrzuca → czyste
  // SALON_STAFF_LIMIT_REACHED (403, poprawna semantyka: limit faktycznie osiągnięty),
  // BEZ Serializable/40001-retry (deterministyczna eliminacja cyklu — jeden wspólny
  // wiersz-przodek wszystkich staff konta). POST-CREATE recount + sentinel ZOSTAJE jako
  // tani belt-and-suspenders in-tx guard (gdyby pojawił się inny, nielockujący writer),
  // ale to JUŻ NIE pierwotny fix wyścigu — lock domyka, recount asekuruje.
  // Helper lockStylistAccountRow celowo NIE importowany z moderation (utrzymanie kierunku
  // zależności między domenami) — 3-linijkowy lock inline = parytet z per-domenowym
  // wzorcem locków (gallery-pin, moderation, support). StylistAccount NIE ma @@map →
  // fizyczna tabela "StylistAccount", PK "account_id" (PascalCase ⇒ cudzysłowy wymagane
  // w Postgres). Lock TYLKO jako side-effect — wynik świadomie odrzucamy (wiersz konta
  // zawsze istnieje: accountId pochodzi z sesji właściciela). Zero `any`/`!`.
  // Wzorzec 1:1: gallery-pin.operations.ts (lock-first + quota-count + post-write recount).
  //
  // DD-H4: invitedUser findFirst hoisted INTO this try/catch so Prisma rejections
  // on the read map to DATABASE_ERROR instead of a generic 500.
  const basePlanLimit = planConfig.max_staff_members;
  // Effective limit = base + paid_staff_seats (assigned inside the try after the account read).
  // Declared here (outer scope) so the race-sentinel mapping in the outer catch can read it.
  let planLimit = basePlanLimit;
  try {
    // Owner's own user id, derived from the stylist account (created_by_user_id is
    // @unique on StylistAccount). Fetched here — NOT taken from the request body —
    // and used purely for the self-invite guard below. Kept inside the try/catch so
    // a Prisma rejection on this read maps to DATABASE_ERROR (parity with DD-H4).
    const ownerAccount = await DB_CLIENT.use.stylistAccount.findUnique({
      where: { account_id: accountId },
      select: { created_by_user_id: true, paid_staff_seats: true },
    });

    // M2 r28: filter out disabled (is_active=false) and admin-disabled (disabled_at set) users.
    // Schema: User.is_active=Boolean default true, User.disabled_at=DateTime? (admin soft-disable).
    // salon-staff-1: lookup uses normalizedEmail (canonical lowercase), not the raw input.
    //
    // DECISION (nie usuwaj tego komentarza) — TYLKO KONTA STYLISTEK MOŻNA WCIĄGNĄĆ DO ZESPOŁU:
    // wiersz członkostwa powstaje od razu jako is_active=true z accepted_at = null i zajmuje
    // miejsce, zanim zaproszona odpowie (akceptuje albo odrzuca sama:
    // respondToStaffInvitation_IO, 2026-09-25), więc bez tego warunku dowolna właścicielka
    // Studio mogła zapisać do swojego salonu KAŻDE zarejestrowane konto — także konto
    // klientki, która nigdy nie miała nic wspólnego z pracą w salonie. Filtrujemy po OBECNOŚCI profilu stylistki
    // (stylist_account), a nie po account_type: account_type to AKTYWNIE przełączona rola
    // (role-switch), więc stylistka przeglądająca appkę jako klientka nadal jest stylistką i musi
    // dać się zaprosić. Konto czysto klienckie nie ma wiersza StylistAccount — nigdy nie przejdzie.
    // Brak dopasowania wpada w to samo maskowanie co nieistniejący e-mail (patrz niżej), więc
    // endpoint nie zdradza, czy adres w ogóle istnieje ani jakiego jest typu.
    const invitedUser = await DB_CLIENT.use.user.findFirst({
      where: {
        email: normalizedEmail,
        is_active: true,
        disabled_at: null,
        stylist_account: { isNot: null },
      },
    });

    // DECISION (nie usuwaj tego komentarza):
    // salon-staff-2 (anti-enumeration): a non-existent / disabled / non-stylist invitee MUST be
    // byte-for-byte indistinguishable from an email that is already on this salon's
    // staff. We therefore return the SAME neutral SALON_STAFF_ALREADY_EXISTS error
    // (mapped to a generic 400 that does NOT echo the email — error-mapper L422-424)
    // for both states, instead of the old distinct 404 USER_NOT_FOUND which
    // definitively revealed "this email is not a Nailfolio account". This mirrors the
    // IDOR/enumeration masking already used in this codebase (EMAIL_USER_NOT_FOUND,
    // SUPPORT_THREAD_NOT_AUTHORIZED → identical-to-not-found, NEWSLETTER ALREADY_SUBSCRIBED).
    // Trade-off accepted by design: an owner who mistypes an email now sees a generic
    // "cannot invite" rather than "user not found" — anti-enumeration consistently
    // trades UX precision for privacy here.
    // RESIDUAL (NOT closed in-file): a registered-but-not-yet-staff email still yields
    // 201, observably different from the 400 above. Fully collapsing that requires
    // switching to an invite-by-email model (uniform "invitation queued" success for
    // unknown emails too) — a product/contract change spanning the handler + a new
    // app-event; see needsKernel/notes. Severity is LOW (authenticated, paid-plan
    // gated, rate-limited), so the residual is left for that dedicated decision.
    if (!invitedUser) {
      return failure({
        type: 'SALON_STAFF_ALREADY_EXISTS',
        email: normalizedEmail,
        salonAccountId: accountId,
      });
    }

    // salon-staff-3 (self-invite guard): the owner already has full control over the
    // salon, so enrolling their own account as staff is meaningless and silently burns
    // a paid quota slot + pollutes the staff list. The @@unique([stylist_account_id,
    // user_id]) does NOT catch this because account_id and user_id are different
    // entities. Reject before any quota work.
    //
    // DECISION (nie usuwaj tego komentarza):
    // FAIL CLOSED on a missing owner row. accountId comes from the authenticated
    // stylist's own session, so ownerAccount is non-null in practice; a null here
    // means the account row vanished mid-request (e.g. concurrent hard-delete race).
    // The OLD guard (`if (ownerAccount && ...)`) silently SKIPPED the self-invite
    // check in that window — fail OPEN — which could let the owner enrol their own
    // user as staff. We now treat a missing owner as a hard error (databaseFailure →
    // 500) instead of proceeding, so the self-invite guard can never be bypassed.
    if (!ownerAccount) {
      return databaseFailure(
        'inviteStaffMember',
        new Error('Owner stylist account not found for self-invite guard')
      );
    }
    if (invitedUser.id === ownerAccount.created_by_user_id) {
      return failure({ type: 'SALON_STAFF_SELF_INVITE', accountId });
    }

    // DECISION (nie usuwaj tego komentarza) — SEAT-BILLING Model B (owner 2026-07-19, /doradca):
    // Studio = WSZYSTKIE konta zespołu W CENIE, zero dopłaty per-seat. Efektywny limit = bazowy
    // limit planu (max_staff_members, dla Studio = 9 → fair-use cap 10 kont) + paid_staff_seats.
    // paid_staff_seats NIE jest już mechanizmem cennikowym (default 0 = limit == bazowy), ale suma
    // ZOSTAJE — kolumna może posłużyć pod Scale/wyjątkowe rozszerzenia bez zmiany kodu (non-breaking).
    // ODWRACA A-lite +35/seat (2026-07-12): per-seat opodatkowywał rdzeń wartości (wiedza zostaje w
    // salonie) i wypychał do współdzielenia konta. Zespół > cap → plan Scale. max=-1 (SCALE) = unlimited.
    // Analiza: PRICING_PACKAGING.md §2.4.
    planLimit = isUnlimitedLimit(basePlanLimit)
      ? UNLIMITED_LIMIT
      : basePlanLimit + ownerAccount.paid_staff_seats;

    return await DB_CLIENT.use.$transaction(async tx => {
      // FOR UPDATE serialization point — see the leading DECISION (finding salon-staff-race).
      // KROK 3b: inline $queryRaw skonsolidowany do kanonicznego lockStylistAccount (@app/db/lock-rows).
      // Taken FIRST in the tx, before the quota count + create, so concurrent invites for this account
      // queue on this one row. Result discarded intentionally (row always exists: accountId from owner session).
      await lockStylistAccount(tx, accountId);

      if (!isUnlimitedLimit(planLimit)) {
        // With the FOR UPDATE lock above held, this count reads COMMITTED state
        // (concurrent invites for this account queue on the lock), so it is now the
        // authoritative quota gate — not merely a fast-fail pre-check.
        const currentStaffCount = await tx.staffMember.count({
          where: liveStaffSeatWhere(accountId),
        });
        if (currentStaffCount >= planLimit) {
          return failure({
            type: 'SALON_STAFF_LIMIT_REACHED',
            currentCount: currentStaffCount,
            limit: planLimit,
            planType: pricingPlan,
          });
        }
      }

      const existingStaff = await tx.staffMember.findUnique({
        where: {
          stylist_account_id_user_id: {
            stylist_account_id: accountId,
            user_id: invitedUser.id,
          },
        },
      });

      if (existingStaff) {
        return failure({
          type: 'SALON_STAFF_ALREADY_EXISTS',
          email: normalizedEmail,
          salonAccountId: accountId,
        });
      }

      const newStaff = await tx.staffMember.create({
        data: {
          stylist_account_id: accountId,
          user_id: invitedUser.id,
          role,
          permissions: [...DEFAULT_PERMISSIONS_BY_ROLE[role]],
          is_active: true,
        },
      });

      // POST-CREATE VERIFY: belt-and-suspenders in-tx recount. After the FOR UPDATE lock
      // above (finding salon-staff-race) the cross-user quota race is closed at the source
      // — invites per account serialize on the lock, so the pre-check count reads committed
      // state and is the authoritative gate. This recount practically never fires now (the
      // pre-check would already have rejected the loser); kept as a cheap guard against any
      // future non-locking writer of StaffMember. finalCount>limit → sentinel → rollback →
      // outer catch maps to SALON_STAFF_LIMIT_REACHED. Pattern parity: gallery-pin recount.
      if (!isUnlimitedLimit(planLimit)) {
        const finalCount = await tx.staffMember.count({
          where: liveStaffSeatWhere(accountId),
        });
        if (finalCount > planLimit) {
          // Throw to trigger rollback — caller handles SALON_STAFF_LIMIT_REACHED via catch
          throw new StaffQuotaRaceRollback();
        }
      }

      // DECISION (nie usuwaj tego komentarza) — ODPOWIEDŹ INVITE BEZ DANYCH ZAPRASZANEJ OSOBY:
      // świadomie NIE dociągamy tu relacji `user` (StaffMemberDTO ma `user?` opcjonalne), więc
      // 201 zwraca sam wiersz członkostwa. Powód: samo znanie adresu e-mail nie może być wyrocznią
      // „e-mail → imię + avatar" — właścicielka Studio wpisywałaby kolejne adresy i odczytywała
      // cudze dane osobowe z odpowiedzi. Lista zespołu (SALON_STAFF_GET_ALL) też ich nie oddaje,
      // dopóki członkostwo nie jest zaakceptowane (maska accepted_at w mapStaffMemberToDTO) —
      // inaczej wyrocznia wracałaby jednym GET-em później. Cofa DD2-H7 r28 („frontend expects user data") —
      // to było błędne rozpoznanie: useInviteMember ignoruje payload i tylko unieważnia
      // queryKeys.staff.all, więc lista i tak odświeża się zaraz po zaproszeniu.
      return success({ staff: mapStaffMemberToDTO(newStaff) });
    });
  } catch (error) {
    if (error instanceof StaffQuotaRaceRollback) {
      return failure({
        type: 'SALON_STAFF_LIMIT_REACHED',
        currentCount: planLimit,
        limit: planLimit,
        planType: pricingPlan,
      });
    }
    // Race-window fallback: concurrent invite created the same (account, user) pair
    // between existsCheck and create — translate P2002 to the proper domain error.
    if (hasCode(error) && error.code === 'P2002') {
      return failure({
        type: 'SALON_STAFF_ALREADY_EXISTS',
        email: normalizedEmail,
        salonAccountId: accountId,
      });
    }
    return databaseFailure('inviteStaffMember', error);
  }
};

export const updateStaffPermissions_IO = async ({
  staffId,
  accountId,
  pricingPlan,
  permissions,
  role,
}: {
  staffId: string;
  accountId: string;
  pricingPlan: PricingPlan;
  permissions?: StaffPermission[] | undefined;
  role?: StaffRole | undefined;
}): Promise<
  OperationResult<
    { staff: StaffMemberDTO },
    | SalonStaffLimitReachedError
    | SalonStaffNotFoundError
    | ValidationError
    | DatabaseError
  >
> => {
  const planConfig = PRICING_POLICY.utils.getPlanConfig(pricingPlan);
  if (!PRICING_POLICY.utils.canUseStaffAccounts(planConfig)) {
    return failure({
      type: 'SALON_STAFF_LIMIT_REACHED',
      currentCount: 0,
      limit: 0,
      planType: pricingPlan,
    });
  }

  // DECISION (nie usuwaj tego komentarza):
  // Defense-in-depth privilege-escalation guard, parallel to the salonStaffInvite /
  // salonStaffUpdate validator floor. The validator already rejects any `role` field
  // on this endpoint, but this op-level reject of OWNER is the last line of defense if
  // a future caller bypasses the validator: a salon has exactly one OWNER (its creator,
  // StylistAccount.created_by_user_id), so reassigning OWNER via a staff update would
  // grant DEFAULT_PERMISSIONS_BY_ROLE.OWNER = all permissions and (frontend gates remove
  // on !isOwner) make the escalated row un-removable. Reject before touching the DB.
  if (role === StaffRoleValue.OWNER) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'role',
      message: 'Role OWNER cannot be assigned via staff update',
    });
  }

  const updateData: { permissions?: StaffPermission[]; role?: StaffRole } = {};
  if (permissions) {
    updateData.permissions = permissions;
  }
  if (role) {
    updateData.role = role;
  }

  if (Object.keys(updateData).length === 0) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'permissions|role',
      message: 'At least one field must be provided',
    });
  }

  // DD2-M2 r28: TOCTOU-safe atomic update — collapses prior findFirst+update window
  // where a concurrent owner-change between the check and the update could mutate
  // a staff row belonging to a different stylist_account_id. updateMany with
  // composite predicate is single-statement atomic; count===0 distinguishes
  // not-found from update-failure (Prisma error code path stays in catch).
  // Mirror dla removeStaffMember (M1 r28 pattern).
  // DD2-H7 r28: post-update findUnique z include user — mapStaffMemberToDTO
  // conditionally spreads user, response shape must include user dla DTO consistency.
  try {
    const result = await DB_CLIENT.use.staffMember.updateMany({
      where: { id: staffId, stylist_account_id: accountId },
      data: updateData,
    });
    if (result.count === 0) {
      return failure({ type: 'SALON_STAFF_NOT_FOUND', staffId });
    }
    const updatedStaff = await DB_CLIENT.use.staffMember.findUnique({
      where: { id: staffId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            is_active: true,
          },
        },
      },
    });
    if (!updatedStaff) {
      // Race: row deleted between update and re-fetch — treat as not found.
      return failure({ type: 'SALON_STAFF_NOT_FOUND', staffId });
    }

    return success({ staff: mapStaffMemberToDTO(updatedStaff) });
  } catch (error) {
    return databaseFailure('updateStaffPermissions', error);
  }
};

export const removeStaffMember_IO = async ({
  staffId,
  accountId,
  // DECISION (nie usuwaj tego komentarza):
  // pricingPlan is intentionally accepted-but-unused (renamed to `_pricingPlan` so
  // `noUnusedParameters` stays satisfied). The property is KEPT in the parameter type
  // for caller-shape parity — the delete handler passes
  // { staffId, accountId, pricingPlan } as a direct object literal, and TS excess-
  // property checks would reject a narrower type. The plan-gate that previously read it
  // was deliberately removed (see block below).
  pricingPlan: _pricingPlan,
}: {
  staffId: string;
  accountId: string;
  pricingPlan: PricingPlan;
}): Promise<
  OperationResult<
    { success: true },
    SalonStaffLimitReachedError | SalonStaffNotFoundError | DatabaseError
  >
> => {
  // DECISION (nie usuwaj tego komentarza):
  // salon-staff-1 (cleanup-after-downgrade): NO canUseStaffAccounts plan-gate here,
  // unlike inviteStaffMember/updateStaffPermissions. Rationale — a STUDIO/SCALE owner
  // who downgrades to a non-staff plan (FREE/PRO) keeps their is_active StaffMember
  // rows (there is no downgrade cleanup hook in plan-status-update.operations.ts).
  // Gating removal on the plan would short-circuit on canUseStaffAccounts BEFORE the
  // deleteMany and return SALON_STAFF_LIMIT_REACHED, stranding those orphan rows
  // un-removable forever (the owner could never self-clean; round-trip downgrade→
  // re-upgrade leaves them intact). The plan-gate exists to block USING the feature
  // (adding/modifying paid staff capacity), NOT to block tearing it down — removal is
  // strictly capacity-reducing and is always the safe direction. SECURITY: removal is
  // already scoped to the caller's own salon via the composite WHERE
  // ({ id: staffId, stylist_account_id: accountId }) where accountId comes from the
  // authenticated stylist session — an owner can only ever delete their own staff rows,
  // so dropping the plan-gate adds no cross-tenant surface. The SalonStaffLimitReachedError
  // variant is retained in the result union for signature parity with the sibling ops and
  // the shared error-mapper case. (Sibling read ops in salon-staff-query.operations.ts
  // have the same plan-gate dropped — a downgraded owner can still DISCOVER staff rows
  // to remove.)

  // M1 r28: TOCTOU-safe atomic delete — collapses prior findFirst+delete window
  // where a concurrent owner-change between the check and the delete could remove
  // a staff row belonging to a different stylist_account_id. deleteMany with
  // composite predicate is single-statement atomic; a delete-failure still lands in
  // the catch (Prisma error code path).
  //
  // DECISION (nie usuwaj tego komentarza) — D1 (2026-09-05), IDEMPOTENCJA:
  // count===0 (wiersz już usunięty — podwójny tap „Zwolnij miejsce", dwa urządzenia,
  // HTTP retry — ALBO id spoza własnego salonu) = TEN SAM sukces. Stan docelowy
  // („tego miejsca nie ma w moim rosterze") jest osiągnięty, a rozróżnianie
  // „cudze" od „już usunięte" po composite WHERE i tak jest niemożliwe bez drugiego
  // odczytu; jednolita odpowiedź nie zdradza istnienia cudzych wierszy (zero
  // oracle). Wcześniejsze SALON_STAFF_NOT_FOUND na count===0 dawało toast błędu PO
  // udanym usunięciu przy każdym ponowieniu. SalonStaffNotFoundError zostaje w unii
  // dla parytetu sygnatur z siostrzanymi operacjami.
  try {
    await DB_CLIENT.use.staffMember.deleteMany({
      where: { id: staffId, stylist_account_id: accountId },
    });
    return success({ success: true });
  } catch (error) {
    return databaseFailure('removeStaffMember', error);
  }
};
