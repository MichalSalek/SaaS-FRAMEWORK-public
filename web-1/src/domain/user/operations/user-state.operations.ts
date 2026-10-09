import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import type { IDType } from '@kernel/application/application.types';
import {
  AccountStatusValue,
  SubscriptionStatusValue,
  type SubscriptionStatus,
} from '@kernel/models/db_models.generated.dto';
import {
  assertType,
  isAccountStatusNarrower,
  isSubscriptionStatusNarrower,
  narrowUser,
} from '@kernel/models/type_narrowing';
import { isP2025 } from '@app/db/prisma-error';
import type { UserWithRelations } from '@kernel/models/user/user.types';
import { USER_POLICY } from '@kernel/policies/user.policy';
import { userRelationsEnabler } from '@domain/user/user.config';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  UserNotFoundError,
  UserHasActiveSubscriptionError,
} from '@kernel/domain/user-and-account/user-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { revokeImpersonationOnEviction } from '@domain/admin/impersonation-eviction';

// DECISION (nie usuwaj tego komentarza):
// Self-disable blokowane gdy active sub — user musi pierwej anulowac w Billing
// (intent split: "anuluj sub" vs "wylacz konto"). Admin disable bypass'uje
// (np. fraud account musi zostac wylaczone niezaleznie od sub). cancelStripeSubscriptionIfExists
// nadal sam handled w delete flow (user-mutations.operations.ts).
const ACTIVE_SUBSCRIPTION_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatusValue.ACTIVE,
  SubscriptionStatusValue.TRIALING,
  SubscriptionStatusValue.PAST_DUE,
  SubscriptionStatusValue.INCOMPLETE,
]);

/**
 * User State Operations (enable/disable)
 */

/**
 * Disable user (set is_active = false, account_status = NOT_ACTIVE, delete sessions)
 */
export const disableUser_IO = async (
  passedUser: UserWithRelations
): Promise<
  OperationResult<UserWithRelations | null, UserNotFoundError | DatabaseError>
> => {
  // DECISION (nie usuwaj tego komentarza):
  // AOBS-1: disable jest IDEMPOTENTNY. Update jest bramkowany WHERE disabled_at:null
  // (atomic guard, parytet z bulk adminBulkDisable_IO WHERE is_active:true) i owiniety
  // w $transaction by uniknac TOCTOU miedzy odczytem a updateMany. Gdy uzytkownik jest
  // JUZ wylaczony (disabled_at != null), updateMany.count === 0 => NIE nadpisujemy
  // disabled_at (znacznik czasu pierwszego banu zostaje nienaruszony) i zwracamy
  // idempotentny success ze swiezym stanem konta — re-disable nie jest bledem.
  // P2025 z guarded update nie odroznia "juz wylaczony" od "nie istnieje", dlatego
  // uzywamy updateMany(count) zamiast update(throws). disabled_at = SSOT idempotencji:
  // is_active samo bylo nadpisywalne bez efektu, ale duplikat audit-eventu USER_DISABLED
  // (emitowany w adminDisableUserAny_IO na .success) + nadpisany timestamp to defekt.
  let userRaw: Awaited<ReturnType<typeof DB_CLIENT.use.user.update>> | null =
    null;
  let stateChanged = false;
  try {
    userRaw = await DB_CLIENT.use.$transaction(async tx => {
      const updated = await tx.user.updateMany({
        where: { id: passedUser.id, disabled_at: null },
        data: { is_active: false, disabled_at: new Date() },
      });

      stateChanged = updated.count > 0;

      // Bramkujemy nastepstwa (cascade account_status + session evict) na faktycznej
      // zmianie stanu: no-op re-disable nie kasuje sesji ani nie dotyka konta.
      if (stateChanged && passedUser.stylist_account) {
        await tx.stylistAccount.updateMany({
          where: { created_by_user_id: passedUser.id },
          data: {
            account_status: assertType(
              AccountStatusValue.NOT_ACTIVE,
              isAccountStatusNarrower,
              'NOT_ACTIVE status'
            ),
          },
        });
      }
      if (stateChanged) {
        await tx.session.deleteMany({ where: { userId: passedUser.id } });
      }

      return await tx.user.findUnique({
        where: { id: passedUser.id },
        include: userRelationsEnabler,
      });
    });
  } catch (error: unknown) {
    if (isP2025(error)) {
      return failure({ type: 'USER_NOT_FOUND', userId: passedUser.id });
    }
    return databaseFailure('disableUser_IO', error);
  }

  // findUnique miss = wiersz nie istnieje => USER_NOT_FOUND (zachowuje semantyke
  // sciezki P2025 sprzed refaktoru; nie ma to zwiazku z idempotentnym no-opem,
  // ktory zwraca istniejacy wiersz).
  if (!userRaw) {
    return failure({ type: 'USER_NOT_FOUND', userId: passedUser.id });
  }

  const narrowed = narrowUser<UserWithRelations>(userRaw, 'disableUser_IO');
  if (!narrowed) {
    reportIssueBackend({
      namespace: 'disableUser_IO',
      message: 'narrowUser returned null after successful update',
      payload: { id: passedUser.id },
      mode: 'error',
    });
    return failure({ type: 'USER_NOT_FOUND', userId: passedUser.id });
  }
  // Eviction cleanup: a disabled mid-impersonation admin's own sessions are deleted
  // above, but the orphaned impersonated (target) session escapes — revoke it +
  // the backup (connected-dots of impersonation-l2-7). Tylko gdy faktycznie
  // wylaczylismy konto w tym wywolaniu (no-op re-disable nie evictuje).
  if (stateChanged) {
    await revokeImpersonationOnEviction(passedUser.id);
  }
  // stateChanged===false = idempotentny no-op (re-disable juz-wylaczonego LUB przegrany
  // CAS pod wspolbieznoscia: dwa USER_DISABLE_ANY na ten sam target). success(null) =>
  // caller (adminDisableUserAny_IO) pomija emit audit-eventu USER_DISABLED — parytet z
  // disableSelfUser_IO, ktory tez zwraca success(null) na przegrany CAS. Winner
  // (stateChanged===true) zwraca swiezy wiersz. To zamyka defekt duplikatu audit-eventu
  // opisany w DECISION nad funkcja: pre-read gate w callerze (getUser_IO PRZED CAS) widzial
  // disabled_at===null w OBU rownoleglych wywolaniach i emitowal audit 2x mimo jednego
  // realnego flipu. Rozroznienie null-no-op od USER_NOT_FOUND: not-found idzie failure()
  // wyzej (userRaw/narrowed null); tutaj narrowed to zawsze wazny wiersz.
  return success(stateChanged ? narrowed : null);
};

/**
 * Enable user (set is_active = true, conditionally activate account)
 */
export const enableUser_IO = async (
  passedUser: UserWithRelations
): Promise<
  OperationResult<UserWithRelations | null, UserNotFoundError | DatabaseError>
> => {
  // DECISION (nie usuwaj tego komentarza):
  // AOBS-1: enable jest IDEMPOTENTNY. Czytamy swiezy wiersz w $transaction (parytet
  // z disableSelfUser_IO / softDeleteAccount_IO w tym pliku) i rozgaleziamy:
  //  (a) brak wiersza                -> USER_NOT_FOUND
  //  (b) deleted_at != null          -> USER_NOT_FOUND (ZACHOWANY guard QA admin-user-mgmt-1:
  //      soft-deleted/RECOVERABLE konto NIE moze byc wskrzeszone tu — reaktywacja
  //      WYLACZNIE przez reactivateAccount_IO; deleted_at = znacznik soft-delete §13.1,
  //      NIGDY auto-zerowany; mirror IDOR-mask tak jak wczesniejszy P2025->USER_NOT_FOUND)
  //  (c) juz wlaczony (disabled_at == null && is_active) -> idempotentny no-op:
  //      NIE nadpisujemy is_active/recovery_available, NIE re-cascade'ujemy account_status,
  //      zwracamy istniejacy wiersz z stateChanged=false => success(null) => caller pomija
  //      duplikat USER_ENABLED (re-enable nie jest bledem).
  //  (d) admin-disabled (disabled_at SET, deleted_at null) -> flip is_active + cascade,
  //      jako COMPARE-AND-SET (WHERE NOT(disabled_at:null AND is_active:true) = negacja (c))
  //      => count 0 pod przegranym wyscigiem => stateChanged=false => success(null) (dedup
  //      audit-eventu USER_ENABLED, parytet z disableUser_IO WHERE disabled_at:null).
  // Sam guard CAS NIE wystarcza dla enable, bo soft-deleted ma disabled_at==null i musi
  // przejsc przez branch (b) (USER_NOT_FOUND), nie flip — stad read-then-branch PRZED CAS
  // (odsiewa soft-deleted), a CAS w branch (d) zamyka wspolbieznosc. Policy-gate
  // account_status czyta payment_status ze
  // SWIEZEGO wiersza (`fresh`, autorytatywny w tx) — parytet z cascadeBulkEnableAccountStatus,
  // ktore tez filtruje po DB payment_status, nie po stale wejsciu.
  let userRaw: Awaited<ReturnType<typeof DB_CLIENT.use.user.update>> | null =
    null;
  let stateChanged = false;
  try {
    userRaw = await DB_CLIENT.use.$transaction(async tx => {
      const freshRaw = await tx.user.findUnique({
        where: { id: passedUser.id },
        include: userRelationsEnabler,
      });
      const fresh = freshRaw
        ? narrowUser<UserWithRelations>(freshRaw, 'enableUser_IO:fresh')
        : null;

      // (a) missing / (b) soft-deleted — both surface as USER_NOT_FOUND.
      if (!fresh || fresh.deleted_at !== null) {
        return null;
      }

      // (c) already enabled — idempotent no-op, return current row untouched.
      // stateChanged pozostaje false => caller (adminEnableUserAny_IO) pomija emit
      // audit-eventu USER_ENABLED. Zwracamy istniejacy wiersz (NIE null — null jest
      // zarezerwowany dla USER_NOT_FOUND w post-tx branchu nizej).
      if (fresh.disabled_at === null && fresh.is_active) {
        return freshRaw;
      }

      // (d) admin-disabled -> re-enable jako COMPARE-AND-SET (parytet z disableUser_IO
      // WHERE disabled_at:null). WHERE NOT(disabled_at:null AND is_active:true) = dokladna
      // negacja bramki (c): matchuje admin-disabled ORAZ zachowany repair stanu
      // (is_active=false / disabled_at=null), a NIE matchuje juz-wlaczonego. Pod
      // wspolbieznoscia (dwa USER_ENABLE_ANY na ten sam target) tylko JEDEN tx flipuje
      // (count 1); przegrany wyscig (rownolegly enable scommitowal flip pierwszy) dostaje
      // count 0 => stateChanged=false => success(null) => caller pomija duplikat
      // audit-eventu USER_ENABLED. deleted_at:null = belt-and-suspenders ((b) juz odsial
      // soft-deleted).
      const flip = await tx.user.updateMany({
        where: {
          id: fresh.id,
          deleted_at: null,
          NOT: { disabled_at: null, is_active: true },
        },
        data: {
          is_active: true,
          disabled_at: null,
          deleted_at: null,
          recovery_available: false,
        },
      });
      stateChanged = flip.count > 0;

      // Cascade account_status TYLKO na faktycznym flipie (no-op / przegrany CAS nie
      // re-cascade'uje — parytet z disableUser_IO stateChanged-gate; concurrent winner
      // juz scascade'owal).
      if (
        stateChanged &&
        fresh.stylist_account &&
        USER_POLICY.utils.CAN_USER_HAVE_ACTIVE_ACCOUNT({ user: fresh })
      ) {
        await tx.stylistAccount.updateMany({
          where: { created_by_user_id: fresh.id },
          data: {
            account_status: assertType(
              AccountStatusValue.ACTIVE,
              isAccountStatusNarrower,
              'ACTIVE status'
            ),
          },
        });
      }

      return await tx.user.findUnique({
        where: { id: fresh.id },
        include: userRelationsEnabler,
      });
    });
  } catch (error: unknown) {
    if (isP2025(error)) {
      return failure({ type: 'USER_NOT_FOUND', userId: passedUser.id });
    }
    return databaseFailure('enableUser_IO', error);
  }

  if (!userRaw) {
    return failure({ type: 'USER_NOT_FOUND', userId: passedUser.id });
  }

  const narrowed = narrowUser<UserWithRelations>(userRaw, 'enableUser_IO');
  if (!narrowed) {
    reportIssueBackend({
      namespace: 'enableUser_IO',
      message: 'narrowUser returned null after successful update',
      payload: { id: passedUser.id },
      mode: 'error',
    });
    return failure({ type: 'USER_NOT_FOUND', userId: passedUser.id });
  }
  // stateChanged===false = idempotentny no-op (branch (c) juz-wlaczony LUB przegrany CAS
  // branch (d)). success(null) => caller pomija duplikat audit-eventu USER_ENABLED
  // (parytet z disableUser_IO). Winner zwraca swiezy wiersz.
  return success(stateChanged ? narrowed : null);
};

/**
 * Sentinel thrown inside the disable $transaction to carry the active-subscription
 * status payload out to the catch site without an unsafe magic property on a bare
 * Error. `instanceof` at the catch site gives a fully-typed `subscriptionStatus`.
 */
class ActiveSubscriptionError extends Error {
  constructor(readonly subscriptionStatus: string) {
    super('__USER_HAS_ACTIVE_SUBSCRIPTION__');
  }
}

/**
 * Disable self user (user disables their own account)
 */
export const disableSelfUser_IO = async ({
  id,
}: {
  id: IDType;
}): Promise<
  OperationResult<
    UserWithRelations | null,
    UserNotFoundError | UserHasActiveSubscriptionError | DatabaseError
  >
> => {
  // DECISION (nie usuwaj tego komentarza):
  // DD2-M3 r28 → r1c (cross-model review GPT-5.5): domkniecie TOCTOU self-disable vs webhook
  // Stripe na subscription_status. WYSCIG: active-sub gate czyta StylistAccount.subscription_status;
  // webhook (plan-status-update.operations.ts) pisze go przez updateMany. CAS wylaczajacy User
  // (User.disabled_at) NIE serializuje sie z zapisem do INNEJ tabeli (StylistAccount) — owiniecie
  // read+CAS w jeden $transaction NIE wystarcza pod READ COMMITTED (brak read-lockow, rozne wiersze).
  // Torn interleave: T1 czyta subscription_status=null -> przechodzi gate; T2 webhook commituje
  // ACTIVE; T1 wylacza -> wylaczony user z aktywna (oplacana) subskrypcja. (Poprzedni komentarz r28
  // twierdzil, ze sam $transaction to zamyka — NIE zamykal; czynil atomowym tylko CAS na User.)
  // FIX: bierzemy pesymistyczny row-lock (SELECT ... FOR UPDATE) na OWNING wierszu StylistAccount
  // i re-read subscription_status POD tym lockiem, ZANIM scommitujemy disable. Webhookowy updateMany
  // na tym samym fizycznym wierszu serializuje sie teraz z nami: albo commitnal PRZED naszym lockiem
  // (czytamy ACTIVE -> reject), albo czeka na nasz lock (wylaczylismy bez aktywnej sub w TAMTYM
  // momencie; jego zapis ACTIVE lada SCISLE PO WAZNYM disable — nie torn read). Rezydual "subskrypcja
  // powstala scisle PO waznym self-disable" (user subskrybuje i self-disable w tej samej ~sekundzie)
  // jest zaakceptowany: blisko-niemozliwy, w pelni odwracalny (reactivate), a mechanizm disable->cancel
  // zyje w delete flow (cancelStripeSubscriptionIfExists) + syncAccountWithStripe rekonsyliuje stan.
  //
  // DECISION (nie usuwaj tego komentarza) — LOCK ORDER (analiza deadlocku, nie usuwaj):
  // StylistAccount FOR UPDATE brany PO CAS na User => zachowana kolejnosc User→StylistAccount uzywana
  // przez KAZDEGO innego multi-row pisarza w tym module + rodzenstwie (disableUser_IO, enableUser_IO,
  // softDeleteAccount_IO, reactivateAccount_IO, admin-bulk-cascade). Webhook lockuje TYLKO StylistAccount
  // (pojedynczy zasob => nie tworzy cyklu). Wiec ten fix dodaje ZERO nowego deadlock-surface — wiersz
  // StylistAccount i tak byl tu lockowany (przez account_status updateMany nizej); bierzemy go tylko
  // kilka instrukcji wczesniej, dalej PO User. INWARIANT UNIFORM: moderation-admin BAN rowniez lockuje
  // User→StylistAccount (lockUserRow PRZED lockStylistAccountRow — patrz LOCK ORDER DECISION w
  // moderation-admin.operations.ts i w lockUserRow helper), wiec globalna kolejnosc User→StylistAccount
  // trzyma KAZDY multi-row pisarz w module i rodzenstwie; wczesniejsza inwersja BAN (StylistAccount→User)
  // zostala ZAMKNIETA. NIE flipuj TEGO path na StylistAccount-first — kolidowaloby z 5 User-first
  // pisarzami wyzej i re-otworzylo cykl ABBA.
  //
  // DECISION (nie usuwaj tego komentarza):
  // user-disable-self-2 (r1b→r2→r1c): KANONICZNA KOLEJNOSC bramek w tx (czytaj inline
  // DECISION przy kazdej):
  //   (1) already-disabled (disabled_at != null) -> idempotentny success(null) OD RAZU
  //       (BEZ active-sub checku, BEZ audytu). To MUSI byc PIERWSZE — inaczej stale/aktywny
  //       subscription_status na juz-wylaczonym koncie zwracalby false-positive
  //       USER_HAS_ACTIVE_SUBSCRIPTION zamiast idempotentnego no-opu, ktory obiecuje kontrakt
  //       (regresja r1b wytknieta przez GPT-5.5). Parytet z enableUser_IO branch (c).
  //   (2) CAS-claim (updateMany User WHERE disabled_at IS NULL): count===0 => przegrany wyscig
  //       => success(null) (idempotent, BEZ audytu); count===1 => winner, trzyma row-lock na User
  //       i przechodzi do gate. CAS PRZED gate, by lock StylistAccount padl PO locku User.
  //   (3) active-sub gate POD StylistAccount FOR UPDATE (re-read subscription_status pod lockiem).
  //       Active sub => ActiveSubscriptionError => ROLLBACK calej tx (CAS cofniety, user NIE
  //       wylaczony) => USER_HAS_ACTIVE_SUBSCRIPTION (user musi pierwej anulowac w Billing).
  //       "claim-then-verify" bezpieczny: pod READ COMMITTED zaden inny tx nie widzi cofnietego
  //       disabled_at (User row-lock trzymany do rollbacku).
  //   (4) winner bez active sub -> cascade account_status (lock juz trzymany) + evict sesji;
  //       caller emituje JEDEN audit.
  //
  // DECISION (nie usuwaj tego komentarza):
  // user-disable-self-1 (wf3): krok (2) to COMPARE-AND-SET, nie unconditional update
  // (parytet z softDeleteAccount_IO WHERE is_active=true i reactivateAccount_IO WHERE
  // recovery_available=true w tym module). Pod READ COMMITTED N rownoleglych self-disable
  // czytalo disabled_at==null i KAZDY robil update + KAZDY emitowal audit USER_DISABLED_SELF
  // (8/8). Teraz tylko JEDEN tx wygrywa CAS (count===1 → winner) i dostaje swiezy wiersz;
  // przegrany wyscig (count===0 po przejsciu short-circuitu (1)) dostaje success(null) BEZ
  // dotkniecia disabled_at. Caller (pages/.../disable/self) emituje audit-event TYLKO gdy
  // data !== null — wiec dokladnie jeden event na logiczny self-disable (parytet z
  // confirmDeleteSelf_IO, ktory short-circuituje na softDeleteResult.data === null).
  // updateMany nie wspiera nested relation writes, wiec stylist account_status + session
  // evict robione osobnymi wywolaniami W TEJ SAMEJ tx DOPIERO po wygranym claimie.
  let userRaw: UserWithRelations | null;

  try {
    userRaw = await DB_CLIENT.use.$transaction(async tx => {
      const freshRaw = await tx.user.findUnique({
        where: { id },
        include: userRelationsEnabler,
      });

      if (!freshRaw) {
        throw new Error('__USER_NOT_FOUND__');
      }

      const fresh = narrowUser<UserWithRelations>(
        freshRaw,
        'disableSelfUser_IO'
      );
      if (!fresh) {
        throw new Error('__USER_NOT_FOUND__');
      }

      // (1) already-disabled short-circuit — MUSI byc PRZED CAS i przed active-sub gate
      // (patrz DECISION o kanonicznej kolejnosci nad funkcja). Idempotentny no-op: NIE
      // nadpisujemy disabled_at (znacznik pierwszego self-disable zostaje), NIE sprawdzamy
      // subskrypcji, NIE evictujemy. success(null) => caller pomija audit-event. Kontrakt
      // "re-self-disable na wylaczonym koncie = idempotentny no-op" — NIE wolno go zlamac
      // false-positivem USER_HAS_ACTIVE_SUBSCRIPTION na stale/aktywnym subscription_status
      // juz-wylaczonego wiersza (user nie ma juz sesji, by anulowac sub; regresja r1b).
      if (fresh.disabled_at !== null) {
        return null;
      }

      // (2) CAS-claim: tylko wiersz JESZCZE-niewylaczony przechodzi (parytet z
      // softDeleteAccount_IO / reactivateAccount_IO). Zdobywa row-lock na User — POTRZEBNY
      // PRZED lockiem StylistAccount nizej (kolejnosc User→StylistAccount, patrz DECISION
      // o lock-order). count===0 => przegrany wyscig (rownolegly self-disable wygral CAS
      // miedzy naszym fresh-read a tym updateMany) => idempotentny no-op.
      const claim = await tx.user.updateMany({
        where: { id: fresh.id, disabled_at: null },
        data: { is_active: false, disabled_at: new Date() },
      });

      if (claim.count === 0) {
        return null;
      }

      // (3) Active-sub gate POD StylistAccount FOR UPDATE. Re-read subscription_status z
      // OWNING wiersza StylistAccount pod pesymistycznym row-lockiem, by zserializowac sie
      // z webhookiem Stripe (plan-status-update.operations.ts updateMany na tym samym
      // fizycznym wierszu). Lock brany PO CAS na User => globalna kolejnosc User→StylistAccount.
      // Klient (brak stylist_account) nie ma subskrypcji => gate pominiety. Active sub =>
      // throw => ROLLBACK cofa CAS (user NIE wylaczony). created_by_user_id jest @unique,
      // wiec FOR UPDATE lockuje dokladnie jeden wiersz. Tabela "StylistAccount" (brak @@map),
      // kolumny cytowane (parytet z lockSessionContainerRow / lockStylistAccountRow).
      if (fresh.stylist_account) {
        // lock-discipline-allow: lock-and-READ by created_by_user_id (NIE lockStylistAccount,
        // ktory lockuje po account_id i zwraca tylko account_id). Tu potrzebny lock NA wierszu
        // wlasciciela PO user_id ORAZ odczyt subscription_status pod tym lockiem (active-sub gate
        // serializowany z webhookiem Stripe). Inny ksztalt niz primityw => swiadomy inline.
        const lockedRows = await tx.$queryRaw<
          { subscription_status: string | null }[]
        >`
          SELECT "subscription_status"
            FROM "StylistAccount"
            WHERE "created_by_user_id" = ${fresh.id}
            FOR UPDATE`;
        const lockedStatus = lockedRows[0]?.subscription_status ?? null;
        if (
          lockedStatus !== null &&
          isSubscriptionStatusNarrower(lockedStatus) &&
          ACTIVE_SUBSCRIPTION_STATUSES.has(lockedStatus)
        ) {
          throw new ActiveSubscriptionError(lockedStatus);
        }

        // (4) Winner bez active sub — cascade account_status (lock StylistAccount juz trzymany
        // przez FOR UPDATE wyzej; updateMany nie wspiera nested relation writes, stad osobny call).
        await tx.stylistAccount.updateMany({
          where: { created_by_user_id: fresh.id },
          data: {
            account_status: assertType(
              AccountStatusValue.NOT_ACTIVE,
              isAccountStatusNarrower,
              'NOT_ACTIVE status'
            ),
          },
        });
      }
      await tx.session.deleteMany({ where: { userId: fresh.id } });

      const updated = await tx.user.findUnique({
        where: { id: fresh.id },
        include: userRelationsEnabler,
      });
      return updated
        ? narrowUser<UserWithRelations>(updated, 'disableSelfUser_IO:fresh')
        : null;
    });
  } catch (error: unknown) {
    if (error instanceof ActiveSubscriptionError) {
      return failure({
        type: 'USER_HAS_ACTIVE_SUBSCRIPTION',
        userId: id,
        subscriptionStatus: error.subscriptionStatus,
      });
    }
    if (error instanceof Error) {
      if (error.message === '__USER_NOT_FOUND__') {
        return failure({ type: 'USER_NOT_FOUND', userId: id });
      }
    }
    if (isP2025(error)) {
      return failure({ type: 'USER_NOT_FOUND', userId: id });
    }
    return databaseFailure('disableSelfUser_IO', error);
  }

  // success(null) = idempotent no-op (already disabled / lost the CAS race). Caller MUST
  // treat null as "nothing newly disabled" and skip the duplicate audit event.
  return success(userRaw);
};
