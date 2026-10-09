import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import {
  EventLogTypeValue,
  PaymentStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { cancelStripeSubscriptionIfExists } from '@app/stripe/customer.operations';
import type {
  BulkActionResult,
  BulkLogoutResult,
} from '@kernel/models/admin/admin.dto';
import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { runWithConcurrency } from '@app/utils/concurrency.utils';
import {
  cascadeBulkDisableAccountStatus,
  cascadeBulkEnableAccountStatus,
} from './admin-bulk-cascade.helper';
import {
  enqueueBulkCancelReconcileRows,
  type BulkCancelReconcileTarget,
} from './admin-bulk-cancel-reconcile.helper';

type BulkOperationError = AdminInsufficientPermissionsError | DatabaseError;

// Ile anulowań Stripe'a leci równolegle w zbiorowym downgradzie na FREE.
// Uzasadnienie wartości: DECISION przy wywołaniu runWithConcurrency niżej.
const BULK_STRIPE_CANCEL_CONCURRENCY = 5;

/**
 * Filter out admin users from target IDs.
 * Returns { nonAdminIds, skippedAdminIds }
 */
const filterAdminUsers = async (
  userIds: string[]
): Promise<{
  nonAdminIds: string[];
  skippedAdminCount: number;
  foundUserIds: string[];
}> => {
  const users = await DB_CLIENT.use.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, role_id: true },
    take: 500,
  });

  const foundUserIds = users.map(u => u.id);
  const nonAdminIds = users
    .filter(u => u.role_id !== SystemRoleId.MASTER_ADMIN)
    .map(u => u.id);
  const skippedAdminCount = users.filter(
    u => u.role_id === SystemRoleId.MASTER_ADMIN
  ).length;

  return { nonAdminIds, skippedAdminCount, foundUserIds };
};

/**
 * Not-found errors for a bulk action: every UNIQUE requested id absent from the
 * DB lookup. Deduped on `new Set(userIds)` (raw user_ids may repeat) and matched
 * against foundUserIds (already deduped by the `IN` findMany). Single source for
 * the three bulk ops (disable / enable / change-plan) — QA admin-bulk-1 dedup that
 * was previously inlined verbatim in each.
 */
const collectNotFoundErrors = (
  userIds: string[],
  foundUserIds: string[]
): BulkActionResult['errors'] => {
  const foundSet = new Set(foundUserIds);
  const errors: BulkActionResult['errors'] = [];
  for (const id of new Set(userIds)) {
    if (!foundSet.has(id)) {
      errors.push({ user_id: id, reason: 'User not found' });
    }
  }
  return errors;
};

/**
 * Admin bulk disable users
 */
export const adminBulkDisable_IO = async ({
  user_ids,
  currentUser,
}: {
  user_ids: string[];
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<BulkActionResult, BulkOperationError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  if (user_ids.length === 0) {
    return success({ affected: 0, skipped: 0, errors: [] });
  }

  try {
    const { nonAdminIds, skippedAdminCount, foundUserIds } =
      await filterAdminUsers(user_ids);
    // DECISION (nie usuwaj tego komentarza):
    // QA consist-2: notFoundCount liczony z `new Set(user_ids).size`, NIE z surowego
    // user_ids.length. foundUserIds pochodzi z DB findMany (IN kolapsuje duplikaty =
    // deduped), wiec surowy user_ids.length - foundUserIds.length zawyzal not_found_count
    // przy duplikatach w wejsciu ([X, X, Y] -> 3 - 2 = 1 mimo 0 brakujacych).
    // Spojne z dedupowana petla errors[] ponizej (oba liczace ze zbioru unikalnych id).
    const uniqueUserIds = new Set(user_ids);
    const notFoundCount = uniqueUserIds.size - foundUserIds.length;

    const errors: BulkActionResult['errors'] = [];
    // DECISION (nie usuwaj tego komentarza):
    // QA admin-bulk-1: iterujemy po `new Set(user_ids)`, NIE po surowym user_ids.
    // Duplikat id w wejsciu (np. [X, X, X]) nie pojawi sie wtedy N razy w errors[]
    // (BulkActionResult.errors = { user_id, reason }[] — kazdy nieznany id raz).
    // `affected` byl juz poprawny (DB IN kolapsuje duplikaty), to byl wylacznie
    // defekt ksztaltu odpowiedzi. Ten sam dedup w bulk-enable i bulk-change-plan.
    errors.push(...collectNotFoundErrors(user_ids, foundUserIds));

    // DECISION (nie usuwaj tego komentarza) — DV1: trzy zalezne writes
    // (user.updateMany → account_status cascade → session.deleteMany) owiniete
    // w JEDNA interaktywna $transaction = atomowo all-or-nothing. Wczesniej byly
    // 3 niezalezne statementy: partial-failure (DB timeout miedzy nimi) zostawial
    // user.is_active=false ale account_status=ACTIVE (= "wylaczony ale publicznie
    // widoczny" — profil/directory/sitemap online dla zdezaktywowanego konta, leak
    // ktory cascade mial naprawic) ALBO zywe sesje gdy session.deleteMany failowal
    // (disabled user trzyma tokeny). Bounded take:500 (filterAdminUsers) → tx
    // duration bezpieczny. Parytet z atomic single-op disableUser_IO.
    const result = await DB_CLIENT.use.$transaction(async tx => {
      const updated = await tx.user.updateMany({
        where: { id: { in: nonAdminIds }, is_active: true },
        data: { is_active: false, disabled_at: new Date() },
      });

      // DECISION (nie usuwaj tego komentarza):
      // QA admin-user-mgmt-1: bulk-disable MUSI kaskadowac account_status=NOT_ACTIVE
      // (parytet z single disableUser_IO). Public profile / directory / sitemap
      // bramkuja WYLACZNIE na StylistAccount.account_status (NIE na User.is_active),
      // wiec sam flip is_active zostawial publiczny profil + PII + wpis w sitemap.xml
      // online dla zbanowanego/wylaczonego stylisty (takedown-efficacy leak).
      // Bezwarunkowo (bez payment-gate) — disable = pelne zdjecie widocznosci.
      await cascadeBulkDisableAccountStatus(tx, nonAdminIds);

      // DECISION (nie usuwaj tego komentarza):
      // DD2-H3 r28: disable BEZ session evict pozwala uzytkownikowi na dostep przez 48h
      // (SESSION_EXPIRES_IN_SECONDS). account-state-guard (request.middleware.ts krok 5b)
      // czyta is_active i blokuje dostep, ale evict sesji tu usuwa tokeny atomicznie z disable.
      // Admin moze wciaz uzyc bulkLogout osobno (przed bulkDisable).
      //
      // QA admin-bulk-2 (accepted residual — NIE dodawac revokeImpersonationOnEviction tutaj):
      // single-op disableUser_IO wola revokeImpersonationOnEviction(userId) bo evictowany
      // user MOZE byc mid-impersonation adminem (jego osierocona sesja TARGETU = userId target,
      // ucieka spod tego deleteMany). W bulk to NIE zachodzi: filterAdminUsers wyklucza
      // MASTER_ADMIN z nonAdminIds, wiec zaden bulk-target nie jest adminem -> backup keyed
      // admin_user_id NIGDY nie pasuje do bulk-targetu (helper bylby gwarantowanym no-opem,
      // tylko N lookupow). Gdy bulk-disablujemy IMPERSONOWANY target, ta deleteMany
      // (userId=target) JUZ kasuje osierocona sesje impersonacji (czesc security-critical).
      // Pozostaly residue = zwisajacy wiersz impersonationBackup (keyed admin_user_id):
      // nieredeemowalny (caller-binding guard w adminSwitchBackToSelf_IO wymaga skasowanego
      // wlasnie tokenu sesji) i sprzatany przez sweep (impersonation-backup-cleanup.interceptor).
      await tx.session.deleteMany({
        where: { userId: { in: nonAdminIds } },
      });

      return updated;
    });

    // L2 r28: runAfterResponse wraps fire-and-forget audit write — on Vercel
    // uses waitUntil() to keep the function alive until DB insert lands; on
    // Render/Node falls back to floating promise. Prevents Edge runtime from
    // killing the insert mid-flight after the HTTP response is sent.
    runAfterResponse(() =>
      writeRawEventLog_IO({
        eventName: APP_EVENTS.INFO.ADMIN.BULK_DISABLE_SUCCESS,
        eventLogType: EventLogTypeValue.ADMIN,
        meta: { created_by_user_id: currentUser.id },
        eventPayloadToStringify: {
          action: 'BULK_DISABLE',
          target_ids: nonAdminIds,
          affected_count: result.count,
          skipped_admin_count: skippedAdminCount,
          not_found_count: notFoundCount,
        },
      })
    );

    return success({
      affected: result.count,
      skipped: skippedAdminCount,
      errors,
    });
  } catch (error) {
    return databaseFailure('adminBulkDisable_IO', error);
  }
};

/**
 * Admin bulk enable users
 */
export const adminBulkEnable_IO = async ({
  user_ids,
  currentUser,
}: {
  user_ids: string[];
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<BulkActionResult, BulkOperationError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  if (user_ids.length === 0) {
    return success({ affected: 0, skipped: 0, errors: [] });
  }

  try {
    const { nonAdminIds, skippedAdminCount, foundUserIds } =
      await filterAdminUsers(user_ids);

    const errors: BulkActionResult['errors'] = [];
    // QA admin-bulk-1: dedup user_ids — patrz komentarz w adminBulkDisable_IO.
    errors.push(...collectNotFoundErrors(user_ids, foundUserIds));

    // DECISION (nie usuwaj tego komentarza):
    // QA admin-user-mgmt-2: WHERE MUSI zawierac `deleted_at: null`. Bez tego guardu
    // bulk-enable lapal soft-deleted (GDPR-erasure-pending) wiersze (is_active=false,
    // deleted_at=SET, recovery_available=true) i bezwarunkowo zerowal deleted_at +
    // recovery_available — wskrzeszajac konto, ktorego user zazadal skasowania, i
    // niszczac znacznik soft-delete (DOMAIN_SSOT §13.1: deleted_at nie jest zerowany
    // poza recovery state-machine). Semantyka admin-ban = flip is_active TYLKO dla
    // rzedow gdzie deleted_at IS NULL. Soft-deleted reaktywuje sie WYLACZNIE przez
    // sankcjonowane reactivateAccount_IO (recovery state-machine), nie tedy.
    // DECISION (nie usuwaj tego komentarza):
    // QA admin-state-cascade-l2-2/l2-3: data MUSI zawierac `disabled_at: null`
    // (parytet z single enableUser_IO, user-state.operations.ts:119-123). Oba
    // disable-paths ustawiaja disabled_at=new Date(); bez wyczyszczenia go w
    // bulk-enable re-aktywowany user zostaje is_active=true ale z STALE disabled_at,
    // co czyni go niewidocznym dla konsumentow filtrujacych na (is_active:true AND
    // disabled_at:null): salon-staff invite lookup (salon-staff-management.operations.ts:89)
    // -> invite cicho failuje jako STAFF_ALREADY_EXISTS; email-change confirm stateGuard
    // (user-email-change.operations.ts:164) -> count=0 -> INVALID_TOKEN. disabled_at
    // = znacznik admin-ban, MUSI byc czyszczony lockstep z is_active (RULE OF THREE,
    // patrz admin-bulk-cascade.helper.ts). account-state-guard NIE czyta disabled_at,
    // wiec user i tak loguje sie do appki — to selektywny drift tych dwoch lookupow.
    // DECISION (nie usuwaj tego komentarza) — DV1: user.updateMany + account_status
    // cascade owiniete w JEDNA $transaction = atomowo. Partial-failure miedzy nimi
    // zostawial user.is_active=true ale account_status NOT_ACTIVE (= re-aktywowany
    // stylista niewidoczny publicznie mimo is_active=true). Parytet z atomic
    // single-op enableUser_IO.
    const result = await DB_CLIENT.use.$transaction(async tx => {
      const updated = await tx.user.updateMany({
        where: { id: { in: nonAdminIds }, is_active: false, deleted_at: null },
        data: {
          is_active: true,
          disabled_at: null,
          deleted_at: null,
          recovery_available: false,
        },
      });

      // DECISION (nie usuwaj tego komentarza):
      // QA admin-user-mgmt-3: bulk-enable MUSI przywrocic account_status=ACTIVE
      // (parytet z single enableUser_IO), inaczej re-aktywowany stylista zostaje
      // niewidoczny publicznie (profil/directory/sitemap bramkuja account_status=ACTIVE)
      // mimo is_active=true. Gate payment_status=PAID = mirror
      // USER_POLICY.CAN_USER_HAVE_ACTIVE_ACCOUNT (single-op nie aktywuje konta bez
      // oplaty). Konta soft-deleted sa juz wykluczone z user.updateMany powyzej, wiec
      // helper nie wskrzesi ich widocznosci (account_status NOT_ACTIVE pozostaje).
      await cascadeBulkEnableAccountStatus(tx, nonAdminIds);

      return updated;
    });

    // L2 r28: runAfterResponse — see BULK_DISABLE_SUCCESS comment above.
    runAfterResponse(() =>
      writeRawEventLog_IO({
        eventName: APP_EVENTS.INFO.ADMIN.BULK_ENABLE_SUCCESS,
        eventLogType: EventLogTypeValue.ADMIN,
        meta: { created_by_user_id: currentUser.id },
        eventPayloadToStringify: {
          action: 'BULK_ENABLE',
          target_ids: nonAdminIds,
          affected_count: result.count,
          skipped_admin_count: skippedAdminCount,
        },
      })
    );

    return success({
      affected: result.count,
      skipped: skippedAdminCount,
      errors,
    });
  } catch (error) {
    return databaseFailure('adminBulkEnable_IO', error);
  }
};

/**
 * Admin bulk change pricing plan
 * Skips users without stylist_account (reported in errors)
 */
export const adminBulkChangePlan_IO = async ({
  user_ids,
  pricing_plan,
  currentUser,
}: {
  user_ids: string[];
  pricing_plan: PricingPlan;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<BulkActionResult, BulkOperationError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  if (user_ids.length === 0) {
    return success({ affected: 0, skipped: 0, errors: [] });
  }

  try {
    const { nonAdminIds, skippedAdminCount, foundUserIds } =
      await filterAdminUsers(user_ids);

    const errors: BulkActionResult['errors'] = [];
    // QA admin-bulk-1: dedup user_ids — patrz komentarz w adminBulkDisable_IO.
    errors.push(...collectNotFoundErrors(user_ids, foundUserIds));

    // Find which non-admin users have stylist accounts (+ rola wlasciciela)
    const stylistAccounts = await DB_CLIENT.use.stylistAccount.findMany({
      where: { created_by_user_id: { in: nonAdminIds } },
      select: {
        created_by_user_id: true,
        // subscription_id: potrzebne do zapisania trwałego zobowiązania „anuluj tę
        // subskrypcję" RAZEM z flipem planu (patrz admin-bulk-cancel-reconcile.helper).
        subscription_id: true,
        created_by_user: { select: { role_id: true, deleted_at: true } },
      },
      take: 500,
    });
    const accountsByUserId = new Map(
      stylistAccounts.map(sa => [sa.created_by_user_id, sa])
    );

    // Guard roli (parytet z single-op adminChangePricingPlan_IO, patrz DECISION
    // w admin-user-management.operations.ts): pricing plan dotyczy WYLACZNIE kont
    // stylist. switchRole STYLIST->CLIENT zostawia osierocony stylist_account
    // (user-onboarding.operations.ts), wiec sam JOIN po created_by_user_id lapal
    // orphany i po cichu windowal konto role_client do PAID/PRO (domain-invariant
    // violation). Odrzucone id raportujemy w errors[] (format jak 'User not found').
    // DECISION (nie usuwaj tego komentarza) — soft-delete guard (parytet z bulk-enable
    // `deleted_at: null` i single-op adminChangePricingPlan_IO): odrzucamy konta
    // GDPR-erasure-pending (deleted_at=SET) z eligibleIds, inaczej stylistAccount.updateMany
    // po `created_by_user_id IN eligibleIds` mutowałby billing na soft-deleted koncie
    // (cascade helper JUŻ filtruje `created_by_user.deleted_at: null`, ale samego zapisu
    // pricing_plan/payment_status nic tu nie chroniło). DOMAIN_SSOT §13.1: soft-deleted
    // NIE resurrektujemy. Raportujemy w errors[] jak pozostałe skip-y.
    const eligibleIds: string[] = [];
    for (const id of nonAdminIds) {
      const account = accountsByUserId.get(id);
      if (!account) {
        errors.push({ user_id: id, reason: 'No stylist account' });
      } else if (
        account.created_by_user.role_id !== SystemRoleId.STYLIST_ROLE
      ) {
        errors.push({
          user_id: id,
          reason: 'Not a stylist (orphan stylist account)',
        });
      } else if (account.created_by_user.deleted_at !== null) {
        errors.push({ user_id: id, reason: 'User is deleted' });
      } else {
        eligibleIds.push(id);
      }
    }

    // Konta, które przy kwalifikacji miały ŻYWĄ subskrypcję — tylko dla nich
    // downgrade na FREE tworzy zobowiązanie do anulowania w Stripe.
    const cancelReconcileTargets: BulkCancelReconcileTarget[] =
      pricing_plan === PricingPlanValue.FREE
        ? eligibleIds.flatMap(id => {
            const subscriptionId =
              accountsByUserId.get(id)?.subscription_id ?? null;
            return subscriptionId === null
              ? []
              : [{ userId: id, subscriptionId }];
          })
        : [];

    const result = await DB_CLIENT.use.$transaction(async tx => {
      const planResult = await tx.stylistAccount.updateMany({
        where: { created_by_user_id: { in: eligibleIds } },
        // OWNER-001 (czerwona flaga, parytet z adminChangePricingPlan_IO): bulk-set też przypina plan,
        // inaczej login-sync cofnąłby go przy następnym logowaniu usera.
        //
        // Parytet payment-state z single-op (setPaymentStateByUserID_IO): admin-set
        // planu przypina też payment_status + zeruje daty (BUG-002: Stripe jest
        // jedynym wlascicielem account_expiration_date / upcoming_payment_date —
        // webhook subscription.updated je odtworzy). Bez tego bulk zostawial konto
        // z przypietym planem, ale payment_status=UNPAID — USER_POLICY.
        // CAN_USER_HAVE_ACTIVE_ACCOUNT gate'uje aktywacje na PAID, wiec wybor 1 vs N
        // userow w tym samym admin UI dawal rozny stan konta. Jeden updateMany
        // zamiast petli setPaymentStateByUserID_IO per konto (zakaz upsert/update
        // w petli — patrz AGENTS.md §PRISMA).
        //
        // DECISION (nie usuwaj tego komentarza) — FREE⇒UNPAID (parytet z single-op
        // targetPaymentStatus, testy-api closing-review): dla planu FREE payment_status
        // MUSI być UNPAID, NIE PAID. FREE+PAID to nonsensowny stan (cały system trzyma
        // FREE⇔UNPAID); dla comp-kont BEZ subskrypcji Stripe cancelStripeSubscriptionIfExists
        // to no-op, więc NIC później nie skoryguje payment_status → FREE+PAID zostałby TRWALE
        // i cascadeBulkEnableAccountStatus lift'nąłby je gałęzią PAID zamiast FREE+plan_selected.
        data: {
          pricing_plan,
          admin_plan_override: true,
          payment_status:
            pricing_plan === PricingPlanValue.FREE
              ? PaymentStatusValue.UNPAID
              : PaymentStatusValue.PAID,
          account_expiration_date: null,
          upcoming_payment_date: null,
        },
      });

      // DECISION (nie usuwaj tego komentarza) — payment-invariant seam (parytet z single-op
      // adminChangePricingPlan_IO): ustawienie payment_status=PAID samo NIE flipuje
      // account_status. Sweep (account-expiry-sweep) robi WYŁĄCZNIE downgrade (ACTIVE→EXPIRING→
      // EXPIRED, subscription-driven), a syncAccountWithStripe POMIJA konta z admin_plan_override
      // (early-return). Bez tego kroku lapsed stylistka (account_status=EXPIRED, is_active=true)
      // "windowana" przez admina na PAID zostaje EXPIRED → niewidoczna w discovery/pairing mimo
      // PAID, bez self-heal. cascadeBulkEnableAccountStatus lift'uje ACTIVE tylko dla
      // is_active+deleted_at:null+(PAID lub FREE+plan_selected) — WHERE no-opuje disabled/
      // soft-deleted (nie odbanowuje), ten sam predykat-lockstep co bulk-enable i CAN_USER_HAVE_ACTIVE_ACCOUNT.
      await cascadeBulkEnableAccountStatus(tx, eligibleIds);

      // Trwałe zobowiązanie „anuluj tę subskrypcję" powstaje RAZEM z commitem planu
      // FREE — pełne uzasadnienie w DECISION-ach w admin-bulk-cancel-reconcile.helper.
      await enqueueBulkCancelReconcileRows(tx, cancelReconcileTargets);

      return planResult;
    });

    // DECISION (nie usuwaj tego komentarza) — orphaned-sub guard (parytet z single-op
    // adminChangePricingPlan_IO): bulk-downgrade do FREE MUSI anulować żywe subskrypcje
    // Stripe, inaczej Stripe DALEJ bilinguje konta oznaczone jako FREE (ghost double-
    // billing = wyciek pieniędzy). Reużywamy cancelStripeSubscriptionIfExists (best-effort,
    // never-throws, sama czyta subscription_id — no-op gdy brak sub, i czyta ŚWIEŻO,
    // więc łapie też subskrypcję dopiętą webhookiem po naszym odczycie kwalifikacyjnym).
    // Poza $transaction (długie zewnętrzne wywołania Stripe NIE mogą trzymać otwartej
    // DB-tx). Tylko dla FREE — downgrade paid→paid idzie proracją przez portal.
    //
    // DECISION (nie usuwaj tego komentarza) — RÓWNOLEGŁOŚĆ OGRANICZONA PULĄ, nie
    // jeden task na usera (zastępuje poprzednią decyzję „task per user"):
    // poprzedni kształt (`for … runAfterResponse(cancel)`) odpalał WSZYSTKIE anulowania
    // naraz. Górna granica to nie take:500, tylko VALIDATION_BULK.MAX_USER_IDS = 100
    // (walidator `user_ids`), więc realnie do 100 równoległych `subscriptions.cancel`
    // wystrzelonych w kilka milisekund. Limit zapisów Stripe to ~100/s, więc taka
    // seria wchodzi prosto w 429: retryStripeOperation cofa się wtedy 1 s/2 s/4 s,
    // batch trwa DŁUŻEJ niż spacing, a każdy wyczerpany budżet dokłada wiersz błędu
    // w EventLog i osobny mail alertowy. Pula 5 daje ~10 zapytań/s (10x pod limitem),
    // 100 kont domyka w ~10 s i nie generuje sztucznych 429.
    // Sprawdzone pomiarem: sama pula Postgresa NIE była tu wąskim gardłem (500
    // równoległych findUnique na puli max:5 = 87 ms, zero błędów) — połączenie jest
    // zwalniane przed wywołaniem Stripe'a. Wąskim gardłem jest wyłącznie Stripe.
    // Trwałość bez zmian: konta, które kwalifikowały się z żywą subskrypcją, mają JUŻ
    // wiersz reconcile zapisany w transakcji wyżej, więc ogon urwany przez 10-sekundowy
    // drain przy SIGTERM dociągnie sweep (stripe-cancel-reconcile). Świadomy trade-off:
    // wolniejszy ogon w zamian za brak szturmu na Stripe'a. `runWithConcurrency` to ten
    // sam prymityw, którego używa sweep maili (EMAIL_LIFECYCLE_CONFIG.SWEEP_CONCURRENCY);
    // jego kontrakt wymaga workera, który NIE rzuca — cancelStripeSubscriptionIfExists
    // jest never-throw z kontraktu.
    if (pricing_plan === PricingPlanValue.FREE) {
      runAfterResponse(() =>
        runWithConcurrency(
          eligibleIds,
          BULK_STRIPE_CANCEL_CONCURRENCY,
          cancelStripeSubscriptionIfExists
        )
      );
    }

    // L2 r28: runAfterResponse — see BULK_DISABLE_SUCCESS comment above.
    runAfterResponse(() =>
      writeRawEventLog_IO({
        eventName: APP_EVENTS.INFO.ADMIN.BULK_CHANGE_PLAN_SUCCESS,
        eventLogType: EventLogTypeValue.ADMIN,
        meta: { created_by_user_id: currentUser.id },
        eventPayloadToStringify: {
          action: 'BULK_CHANGE_PLAN',
          target_ids: eligibleIds,
          affected_count: result.count,
          skipped_admin_count: skippedAdminCount,
          new_plan: pricing_plan,
          admin_plan_override_set: true,
          // Ile kont weszło do downgrade'u z żywą subskrypcją = tyle trwałych
          // zobowiązań do anulowania commitnęliśmy razem z planem.
          cancel_reconcile_enqueued: cancelReconcileTargets.length,
        },
      })
    );

    return success({
      affected: result.count,
      skipped: skippedAdminCount,
      errors,
    });
  } catch (error) {
    return databaseFailure('adminBulkChangePlan_IO', error);
  }
};

/**
 * Admin bulk logout users (delete all sessions)
 */
export const adminBulkLogout_IO = async ({
  user_ids,
  currentUser,
}: {
  user_ids: string[];
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<BulkLogoutResult, BulkOperationError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  if (user_ids.length === 0) {
    return success({ affected: 0, sessionsDeleted: 0 });
  }

  try {
    const { nonAdminIds, skippedAdminCount } = await filterAdminUsers(user_ids);

    // DECISION (nie usuwaj tego komentarza):
    // QA admin-bulk-2 (accepted residual — NIE dodawac revokeImpersonationOnEviction):
    // bulk-logout wyklucza adminow (filterAdminUsers), wiec zaden target nie jest
    // mid-impersonation adminem — w przeciwienstwie do single-op deleteAllSessionsOfUser_IO,
    // ktore moze targetowac admina. Osierocona sesja impersonowanego targetu (userId=target)
    // jest juz kasowana przez ta deleteMany. Pelne uzasadnienie: adminBulkDisable_IO powyzej.
    const result = await DB_CLIENT.use.session.deleteMany({
      where: { userId: { in: nonAdminIds } },
    });

    // L2 r28: runAfterResponse — see BULK_DISABLE_SUCCESS comment above.
    runAfterResponse(() =>
      writeRawEventLog_IO({
        eventName: APP_EVENTS.INFO.ADMIN.BULK_LOGOUT_SUCCESS,
        eventLogType: EventLogTypeValue.ADMIN,
        meta: { created_by_user_id: currentUser.id },
        eventPayloadToStringify: {
          action: 'BULK_LOGOUT',
          target_ids: nonAdminIds,
          sessions_deleted: result.count,
          skipped_admin_count: skippedAdminCount,
        },
      })
    );

    return success({
      affected: nonAdminIds.length,
      sessionsDeleted: result.count,
    });
  } catch (error) {
    return databaseFailure('adminBulkLogout_IO', error);
  }
};
