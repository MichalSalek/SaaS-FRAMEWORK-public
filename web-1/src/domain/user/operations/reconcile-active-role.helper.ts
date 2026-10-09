import type { Prisma } from '../../../prisma/js-client';
import {
  ACCOUNT_TYPE_TO_ROLE_ID,
  SystemRoleId,
} from '@kernel/models/db_models.manual.dto';
import type { AccountType } from '@kernel/domain/user-and-account/role_switch.config';

// DECISION (nie usuwaj tego komentarza):
// Pojedynczy kanoniczny mutator aktywnej roli usera. account_type (kolumna stored)
// i role_id (kolumna stored, decyzyjna dla RBAC w request.middleware.ts) MUSZA byc
// zapisywane RAZEM i atomowo via ACCOUNT_TYPE_TO_ROLE_ID — inaczej powstaje
// split-brain: session DTO reklamuje role, ktorej backend nie honoruje (soft lockout).
// RULE OF THREE: switchRole + onboardAsStylist + onboardAsClient potrzebowaly tej samej
// mutacji; wczesniej onboard-* pisaly tylko role_id (pomijajac account_type) ORAZ robily
// to tylko na sciezce create — stad desync + cichy no-op gdy konto juz istnialo.
// Helper przyjmuje aktywna tx (Prisma.TransactionClient), bo reconcile MUSI byc w tej samej
// transakcji co find-or-create konta (spojnosc konto<->rola).
//
// DECISION (nie usuwaj tego komentarza) — MASTER_ADMIN guard (QA admin-moderation-1 / user-onboarding-role-1):
// ACCOUNT_TYPE_TO_ROLE_ID mapuje WYLACZNIE STYLIST->role_stylist / CLIENT->role_client.
// Bez guardu MASTER_ADMIN ktory onboarduje/przelacza role (LOGGED_USER_PERMISSIONS zawiera te eventy,
// wiec admin moze je wywolac) byl bezwarunkowo demotowany do role_stylist/role_client — trwala utrata
// uprawnien admina BEZ sciezki recovery przez API (re-promote tylko out-of-band: OAuth re-stamp dla emaili
// z MASTER_ADMIN_EMAIL albo restart serwera). To NIE jest split-brain z powyzszej decyzji: admin moze
// LEGALNIE trzymac account_type STYLIST/CLIENT (zeby testowac produkt) zachowujac role_id=MASTER_ADMIN —
// RBAC w request.middleware.ts czyta role_id, account_type steruje tylko kontekstem konta. Wiec gdy biezacy
// role_id === MASTER_ADMIN: zapisujemy TYLKO account_type, role_id pozostaje MASTER_ADMIN (admin = adminem).
// Odczyt role_id MUSI byc w tej samej tx co update (spojnosc, brak TOCTOU wzgledem find-or-create konta).
export const reconcileActiveRole = async (
  tx: Prisma.TransactionClient,
  userId: string,
  targetAccountType: AccountType
): Promise<void> => {
  const current = await tx.user.findUnique({
    where: { id: userId },
    select: { role_id: true },
  });

  // UncheckedUpdateInput (nie UpdateInput): role_id to skalarny FK — settable wprost
  // tylko w wariancie Unchecked; UpdateInput wymagalby role: { connect }.
  const data: Prisma.UserUncheckedUpdateInput =
    current?.role_id === SystemRoleId.MASTER_ADMIN
      ? { account_type: targetAccountType }
      : {
          account_type: targetAccountType,
          role_id: ACCOUNT_TYPE_TO_ROLE_ID[targetAccountType],
        };

  await tx.user.update({
    where: { id: userId },
    data,
  });
};
