import type { Prisma } from '../../prisma/js-client';
import type { StaffPermission } from '@kernel/domain/user-and-account/staff_accounts.config';
import type { StaffMemberDTO } from '@kernel/models/salon-staff/salon-staff.dto';

type StaffMemberInput =
  Prisma.StaffMemberGetPayload<Prisma.StaffMemberDefaultArgs> & {
    user?: {
      id: string;
      name: string | null;
      email: string;
      image: string | null;
      /** User.is_active — brak w select = traktowane jak żywe (mapper nie zgaduje). */
      is_active?: boolean;
    } | null;
  };

// DECISION (nie usuwaj tego komentarza) — D1 (2026-09-05), MASKA WIDMOWEGO MIEJSCA:
// osoba z zespołu o NIEAKTYWNYM koncie (User.is_active=false: soft-delete w oknie
// 90 dni albo ban) nadal zajmuje miejsce (liveStaffSeatWhere niżej), więc wiersz
// JEST w rosterze — ale jako „Konto nieaktywne": name/email/image ZAMASKOWANE TUTAJ,
// po stronie serwera (roster i detal pokazywały dotąd pełne PII martwego konta), a
// `user_inactive=true` napędza w UI wariant wiersza z akcją „Zwolnij miejsce"
// (= removeStaffMember_IO). id/user_id zostają — usuwanie idzie po id.
//
// DECISION (nie usuwaj tego komentarza) — ZAPROSZENIE BEZ AKCEPTACJI NIE UJAWNIA TOŻSAMOŚCI:
// wiersz członkostwa powstaje od razu przy zaproszeniu po e-mailu z accepted_at = null, więc
// bez maski właścicielka Studio mogłaby wpisać dowolny adres stylistki, a lista zespołu
// natychmiast oddawałaby jej imię i avatar — dokładnie ta wyrocznia „e-mail -> imię + avatar",
// którą odpowiedź INVITE zamyka świadomie (DECISION w inviteStaffMember_IO). Dopóki
// accepted_at === null, name i image są null; e-mail zostaje, bo to adres, który właścicielka
// sama wpisała (UI pokazuje go jako nazwę wiersza, z dopiskiem „oczekuje na akceptację” po
// `accepted_at === null` w DTO). Maska siedzi w mapperze, więc obejmuje listę, detal i
// odpowiedź zmiany uprawnień naraz. Akceptację zapisuje WYŁĄCZNIE zaproszona osoba
// (respondToStaffInvitation_IO, 2026-09-25): to jej zgoda na pokazanie imienia i zdjęcia
// w zespole tego salonu, i ten zapis odsłania dane bez zmian tutaj.
export const mapStaffMemberToDTO = (
  staff: StaffMemberInput
): StaffMemberDTO => {
  const userInactive = staff.user?.is_active === false;
  const identityHidden = userInactive || staff.accepted_at === null;
  return {
    id: staff.id,
    stylist_account_id: staff.stylist_account_id,
    user_id: staff.user_id,
    role: staff.role,
    permissions: staff.permissions as StaffPermission[],
    is_active: staff.is_active,
    created_at: staff.invited_at.toISOString(),
    user_inactive: userInactive,
    accepted_at: staff.accepted_at?.toISOString() ?? null,
    ...(staff.user && {
      user: {
        id: staff.user.id,
        name: identityHidden ? null : staff.user.name,
        email: userInactive ? '' : staff.user.email,
        image: identityHidden ? null : staff.user.image,
      },
    }),
  };
};

// DECISION (nie usuwaj tego komentarza) — DEFINICJA ZAJĘTEGO MIEJSCA (seat) W SALONIE:
// miejsce jest zajęte, dopóki żyje WIERSZ CZŁONKOSTWA (StaffMember.is_active) — niezależnie
// od tego, czy konto zaproszonej osoby jest w danej chwili żywe.
//
// Była tu wersja wymagająca dodatkowo żywotności konta (User.is_active + brak disabled_at),
// żeby martwe konto nie trzymało płatnego miejsca. Okazała się gorsza od problemu, który
// naprawiała, i to w tej samej klasie co capy par (patrz pairing-cap.predicates.ts):
// zwalniała miejsce, choć wiersz członkostwa dalej istniał, więc po powrocie konta
// (odzyskanie w oknie 90 dni albo odbanowanie) salon zostawał TRWALE ponad limitem —
// Studio z dziewięcioma miejscami kończyło z dziesięcioma, bez niczego, co by to
// rekoncyliowało. Ten sam wiersz komentarza obiecywał zresztą, że „członkostwo i miejsce
// wracają razem" — i właśnie to przekraczało limit.
//
// Koszt obecnej wersji jest realny i ZNANY: miejsce po osobie, która skasowała konto, zostaje
// zajęte, dopóki właścicielka salonu go nie usunie z rostera (usuwanie działa — `removeStaffMember_IO`
// kasuje po `id` + `stylist_account_id`, nie przez ten filtr).
// DOMKNIĘTE decyzją właściciela D1 (2026-09-05): wariant „jawne oznaczanie w UI" —
// taki wiersz jest w rosterze jako „Konto nieaktywne" (maska w mapStaffMemberToDTO
// wyżej) z akcją „Zwolnij miejsce". Rekoncyliacji przy przywracaniu konta NIE MA
// (świadomie: to ona produkowała trwałe przekroczenie limitu). Predykat bez zmian.
export const liveStaffSeatWhere = (
  stylistAccountId: string
): Prisma.StaffMemberWhereInput => ({
  stylist_account_id: stylistAccountId,
  is_active: true,
});

/**
 * The name an invitee sees for the inviting salon (invitation list and e-mail):
 * the owner's public display name, then her account name, then the salon's
 * business name. '' when none is set; callers decide what an empty name means.
 * display_name is nullable in the DB but app-required, so the fallbacks are rare
 * (SCHEMA_DECISIONS.md#stylistaccount-display-name-nullable).
 */
export const resolveInviterName = (salon: {
  display_name: string | null;
  business_name: string | null;
  created_by_user: { name: string | null } | null;
}): string =>
  salon.display_name?.trim() ||
  salon.created_by_user?.name?.trim() ||
  salon.business_name?.trim() ||
  '';
