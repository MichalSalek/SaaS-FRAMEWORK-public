import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { emitAdminUserAudit } from '@domain/admin/operations/admin-user-audit.helper';
import type { IDType } from '@kernel/application/application.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import type { UserWithRelations } from '@kernel/models/user/user.types';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
// User operations accessed via application-layer facade (not cross-domain import)
import {
  adminDisableUser as disableUser_IO,
  adminEnableUser as enableUser_IO,
  adminDeleteUser as deleteUser_IO,
  adminGetUser as getUser_IO,
  adminSetPaymentState as setPaymentStateByUserID_IO,
} from '@app/admin/user-administration.service';
import { cancelStripeSubscriptionIfExists } from '@app/stripe/customer.operations';
import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  AdminInsufficientPermissionsError,
  AdminTargetNotFoundError,
  AdminTargetProtectedError,
} from '@kernel/domain/admin/admin-errors.types';
import type { UserNotFoundError } from '@kernel/domain/user-and-account/user-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import {
  requireAdminPermission,
  requireTargetNotProtected,
} from '@domain/admin/admin.guards';
import { cascadeBulkEnableAccountStatus } from '@domain/admin/operations/admin-bulk-cascade.helper';
import { cleanupCloudinaryAssets } from '@domain/gallery/operations/gallery-cloudinary-cleanup';
import { collectStylistAvatarUrlsForUser_IO } from '@domain/account/operations/account-avatar.operations';
import { collectVisitResultPhotoUrlsForUser_IO } from '@domain/visit/operations/visit-result-photo.operations';
import { cleanupNewsletterSubscriberByEmail } from '@domain/user/operations/user-mutations.operations';
import { databaseFailure } from '@app/errors/error-result.helpers';

type DisableUserResponse = OperationResult<
  UserWithRelations | null,
  | AdminInsufficientPermissionsError
  | AdminTargetProtectedError
  | AdminTargetNotFoundError
  | UserNotFoundError
  | DatabaseError
>;

type EnableUserResponse = OperationResult<
  UserWithRelations | null,
  | AdminInsufficientPermissionsError
  | AdminTargetProtectedError
  | AdminTargetNotFoundError
  | UserNotFoundError
  | DatabaseError
>;

type ChangePricingPlanResponse = OperationResult<
  void,
  | AdminInsufficientPermissionsError
  | AdminTargetProtectedError
  | AdminTargetNotFoundError
  | UserNotFoundError
  | DatabaseError
>;

/**
 * Admin deletes any user
 */
export const adminDeleteUserAny_IO = async ({
  target_id,
  currentUser,
}: {
  target_id: IDType;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<DisableUserResponse> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  const protectionCheck = await requireTargetNotProtected({
    targetUserId: target_id,
    currentUserId: currentUser.id,
  });
  if (!protectionCheck.success) {
    return protectionCheck;
  }

  let userToBeDeleted;
  try {
    userToBeDeleted = await getUser_IO({
      props: { id: target_id },
      withRelations: true,
    });
  } catch (error) {
    return databaseFailure('adminDeleteUserAny_IO', error);
  }
  if (!userToBeDeleted) {
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId: target_id,
      targetType: 'USER',
    });
  }

  // Capture email before delete for GDPR newsletter cleanup (parity with self/other paths)
  const deletedEmail = userToBeDeleted.email;

  // Cancel Stripe subscription before deletion (best-effort, non-blocking)
  await cancelStripeSubscriptionIfExists(userToBeDeleted.id);

  // Collect Cloudinary asset URLs before cascade-delete removes records
  let galleryRecords;
  try {
    galleryRecords = await DB_CLIENT.use.galleryRecord.findMany({
      where: { created_by_account: { created_by_user_id: userToBeDeleted.id } },
      select: { asset_url: true },
      take: 5000, // Safety cap — prevent OOM for power-user accounts (parity with deleteSelfUser_IO)
    });
  } catch (error) {
    return databaseFailure('adminDeleteUserAny_IO', error);
  }

  // Also collect VisitResultPhoto assets (karta klientki) — cascade removes them too, blobs would
  // otherwise orphan in Cloudinary (parity with gallery). Best-effort (returns [] on error).
  // Zdjęcie profilowe doszło 2026-09-09 (parytet z self hard-delete). Oba zbiory
  // są best-effort i niezależne, więc lecą równolegle.
  const [visitPhotoUrls, avatarUrls] = await Promise.all([
    collectVisitResultPhotoUrlsForUser_IO(userToBeDeleted.id),
    collectStylistAvatarUrlsForUser_IO(userToBeDeleted.id),
  ]);

  // DECISION (nie usuwaj tego komentarza):
  // No explicit session.deleteMany needed — Session model has onDelete: Cascade on User FK
  // (schema.prisma L44). deleteUser_IO cascades all sessions automatically.
  const deleteResult = await deleteUser_IO({ id: userToBeDeleted.id });
  if (!deleteResult.success) {
    // DECISION (nie usuwaj tego komentarza):
    // Discriminate na typie błędu — deleteUser_IO zwraca UserNotFoundError ALBO
    // DatabaseError (P2003 FK violation, user-crud.operations.ts L182-184). Bez
    // tego rozróżnienia DATABASE_ERROR ginąłby jako false-404 (admin widzi "not
    // found" zamiast 500, a realny błąd DB znika). USER_NOT_FOUND → admin-semantyka
    // ADMIN_TARGET_NOT_FOUND; reszta (DatabaseError) → propaguj surowo do 500
    // (parytet z self/other path, które forwardują deleteResult.error wprost).
    if (deleteResult.error.type === 'USER_NOT_FOUND') {
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: userToBeDeleted.id,
        targetType: 'USER',
      });
    }
    return failure(deleteResult.error);
  }

  // DECISION (nie usuwaj tego komentarza):
  // GDPR Art. 17 — cascade NewsletterSubscriber by email (no FK to User). Parity z
  // self (deleteSelfUser_IO, /gdpr-erase): NewsletterSubscriber jest
  // email-keyed i NIE ma FK do User, więc User-FK cascade w deleteUser_IO go nie dosięga
  // → admin hard-delete musi posprzątać go jawnie, inaczej zostawia osieroconą PII
  // subskrybenta (email, ip_address, consent_timestamp, consent_source) na zawsze.
  // Email wzięty PRZED delete; await (mirror self/other) — helper sam łapie błędy
  // (dead-letter log w środku), więc nie hard-failuje już dokonanego usunięcia usera.
  await cleanupNewsletterSubscriberByEmail(
    deletedEmail,
    'adminDeleteUserAny_IO',
    userToBeDeleted.id
  );

  // DECISION (nie usuwaj tego komentarza):
  // Admin-takedown = terminal hard-delete. deleteUser_IO (prymityw) sam zapisuje pełne body do
  // DeletedUser i ustawia is_gdpr_erased=true w tej samej tx (self-protecting)
  // → backup jest non-restorable OD RAZU, więc /restore-account go nie widzi i admin-takedown
  // NIE jest cicho odwracalny przez re-rejestrację na ten sam email. Nie wołamy osobnego finalize:
  // marker ustawia prymityw. Wiersz archiwum usuwa admin hard-purge DeletedUser (Art.17).

  // Fire-and-forget: cleanup Cloudinary assets (GDPR Art. 17) — gallery + visit-result photos.
  const assetUrls = galleryRecords
    .map(r => r.asset_url)
    .concat(visitPhotoUrls, avatarUrls);
  if (assetUrls.length > 0) {
    cleanupCloudinaryAssets(assetUrls);
  }

  await emitAdminUserAudit(APP_EVENTS.INFO.USER.USER_DELETED, currentUser.id, {
    target_id: userToBeDeleted.id,
    deleted_at: new Date(),
  });

  return success(deleteResult.data);
};

/**
 * Admin disables any user
 */
export const adminDisableUserAny_IO = async ({
  target_id,
  currentUser,
}: {
  target_id: IDType;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<DisableUserResponse> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  const protectionCheck = await requireTargetNotProtected({
    targetUserId: target_id,
    currentUserId: currentUser.id,
  });
  if (!protectionCheck.success) {
    return protectionCheck;
  }

  let userToBeDisabled;
  try {
    userToBeDisabled = await getUser_IO({
      props: { id: target_id },
      withRelations: true,
    });
  } catch (error) {
    return databaseFailure('adminDisableUserAny_IO', error);
  }
  if (!userToBeDisabled) {
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId: target_id,
      targetType: 'USER',
    });
  }

  // DECISION (nie usuwaj tego komentarza):
  // AOBS-1: emit audit-eventu USER_DISABLED bramkujemy na WYNIKU CAS (disableResult.data
  // !== null), NIE na pre-readzie disabled_at. disableUser_IO jest idempotentny (updateMany
  // WHERE disabled_at:null) i zwraca success(null) na no-op (re-disable juz-wylaczonego LUB
  // przegrany CAS pod wspolbieznoscia). Poprzednia bramka (didDisable = pre-read getUser_IO
  // PRZED operacja) byla dziurawa pod wspolbieznoscia: dwa rownolegle USER_DISABLE_ANY na ten
  // sam target oba czytaly disabled_at===null (zanim ktorykolwiek scommitowal CAS) => oba
  // emitowaly audit, mimo ze CAS flipnal stan tylko raz => duplikat audit-eventu. Bramka na
  // wyniku CAS emituje DOKLADNIE raz na logiczny disable (parytet z disable/self, ktory gatuje
  // na softDeleteResult.data === null).
  const disableResult = await disableUser_IO(userToBeDisabled);
  if (!disableResult.success) {
    return disableResult;
  }

  if (disableResult.data !== null) {
    await emitAdminUserAudit(
      APP_EVENTS.INFO.USER.USER_DISABLED,
      currentUser.id,
      {
        target_id: userToBeDisabled.id,
        disabled_at: new Date(),
      }
    );
  }

  return success(disableResult.data);
};

/**
 * Admin enables any user
 */
export const adminEnableUserAny_IO = async ({
  target_id,
  currentUser,
}: {
  target_id: IDType;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<EnableUserResponse> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  const protectionCheck = await requireTargetNotProtected({
    targetUserId: target_id,
    currentUserId: currentUser.id,
  });
  if (!protectionCheck.success) {
    return protectionCheck;
  }

  let userToBeEnabled;
  try {
    userToBeEnabled = await getUser_IO({
      props: { id: target_id },
      withRelations: true,
    });
  } catch (error) {
    return databaseFailure('adminEnableUserAny_IO', error);
  }
  if (!userToBeEnabled) {
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId: target_id,
      targetType: 'USER',
    });
  }

  // DECISION (nie usuwaj tego komentarza):
  // AOBS-1: emit audit-eventu USER_ENABLED bramkujemy na WYNIKU CAS (enableResult.data
  // !== null), NIE na pre-readzie. enableUser_IO zwraca success(null) na no-op (branch c
  // juz-wlaczony LUB przegrany CAS branch d pod wspolbieznoscia). Poprzednia bramka
  // (wasAlreadyEnabled = pre-read getUser_IO) byla dziurawa pod wspolbieznoscia: dwa
  // rownolegle USER_ENABLE_ANY na admin-disabled target oba czytaly disabled_at!=null =>
  // oba emitowaly audit, mimo ze CAS flipnal raz => duplikat. Bramka na wyniku CAS emituje
  // DOKLADNIE raz na logiczny enable (parytet z adminDisableUserAny_IO / disable-self).
  const enableResult = await enableUser_IO(userToBeEnabled);
  if (!enableResult.success) {
    return enableResult;
  }

  if (enableResult.data !== null) {
    await emitAdminUserAudit(
      APP_EVENTS.INFO.USER.USER_ENABLED,
      currentUser.id,
      {
        target_id: userToBeEnabled.id,
        enabled_at: new Date(),
      }
    );
  }

  return success(enableResult.data);
};

/**
 * Admin changes pricing plan for any user
 */
export const adminChangePricingPlan_IO = async ({
  target_id,
  pricing_plan,
  currentUser,
}: {
  target_id: IDType;
  pricing_plan: ADMIN_DTO_API_V1['ADMIN_CHANGE_PRICING_PLAN']['REQUEST']['pricing_plan'];
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<ChangePricingPlanResponse> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  const protectionCheck = await requireTargetNotProtected({
    targetUserId: target_id,
    currentUserId: currentUser.id,
  });
  if (!protectionCheck.success) {
    return protectionCheck;
  }

  let targetUser;
  try {
    targetUser = await getUser_IO({
      props: { id: target_id },
      withRelations: true,
    });
  } catch (error) {
    return databaseFailure('adminChangePricingPlan_IO', error);
  }
  // DECISION (nie usuwaj tego komentarza) — soft-delete target guard (parytet z
  // bulk-enable `deleted_at: null`, admin-bulk.operations.ts, i change-plan bulk
  // eligibility). getUser_IO to plain findUnique BEZ filtra stanu, więc bez
  // `deleted_at !== null` admin mógłby mutować billing (pricing_plan/payment_status/
  // override) na koncie GDPR-erasure-pending (is_active=false, deleted_at=SET,
  // recovery_available=true). DOMAIN_SSOT §13.1: `deleted_at` NIGDY auto-modyfikowany —
  // soft-deleted kont NIE resurrektujemy zmianą planu. Zlane z not-found → 404
  // (targetType USER): dla admina to konto "nie istnieje" jako edytowalny cel.
  if (!targetUser || targetUser.deleted_at !== null) {
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId: target_id,
      targetType: 'USER',
    });
  }

  // DECISION (nie usuwaj tego komentarza) — SCALE i FREE są ŚWIADOMIE settable przez
  // admina (walidator kernela z.enum(PricingPlanValue) przepuszcza pełny zbiór planów):
  //   - FREE  = comp/grant/downgrade (owner cofa płacącego lub nadaje darmowe konto),
  //   - SCALE = plan bez Stripe-price, negocjowany manualnie (owner ustawia go ręcznie
  //     po umowie custom, brak self-serve checkout dla SCALE = by-design).
  // To operacja MASTER_ADMIN-only (requireTargetNotProtected + requireAdminPermission),
  // więc pełny zakres planów jest zamierzony, nie luka. Nie zawężamy allowlisty.
  //
  // DECISION (nie usuwaj tego komentarza):
  // Pricing plans dotyczą WYŁĄCZNIE kont stylist — setPaymentStateByUserID_IO
  // mutuje stylist_account (pricing_plan + payment_status=PAID + daty). Bez tego
  // guardu admin mógłby oznaczyć konto role_client jako płacącego stylistę, JEŚLI
  // user nosi osierocony stylist_account (switchRole STYLIST→CLIENT tworzy
  // client_account, ale NIE kasuje stylist_account → user-onboarding.operations.ts
  // L241-249). Sprawdzamy OBA warunki (rola + obecność konta):
  //   - role_id !== STYLIST_ROLE  → odrzuca orphan (role_client + leftover account),
  //     który inaczej zostałby po cichu wywindowany do PRO/PAID (domain-invariant violation),
  //   - !stylist_account          → daje czytelny 404 (targetType ACCOUNT) zamiast
  //     mylącego USER_NOT_FOUND z P2025 wewnątrz setPaymentStateByUserID_IO.
  // Guard MUSI być po requireTargetNotProtected (pattern parity: permission/protection
  // przed business-invariantem). Zwracamy ADMIN_TARGET_NOT_FOUND/ACCOUNT — istniejący
  // wariant unii, mapowany na 404 w error-mapper (semantyka: brak edytowalnego konta).
  if (
    targetUser.role_id !== SystemRoleId.STYLIST_ROLE ||
    !targetUser.stylist_account
  ) {
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId: target_id,
      targetType: 'ACCOUNT',
    });
  }

  const oldPlan = targetUser.stylist_account.pricing_plan;

  const paymentResult = await setPaymentStateByUserID_IO({
    id: target_id,
    pricing_plan,
    adminPlanOverride: true,
  });

  if (!paymentResult.success) {
    return paymentResult;
  }

  // DECISION (nie usuwaj tego komentarza) — payment-invariant seam: setPaymentStateByUserID_IO
  // ustawia payment_status=PAID, ale account_status NIE jest przez nikogo przeliczany dla kont
  // z admin_plan_override — sweep robi tylko downgrade (subscription-driven), a
  // syncAccountWithStripe POMIJA override-konta (early-return). Bez tego kroku admin
  // "windowujący" lapsed stylistkę (account_status=EXPIRED, is_active=true) na PAID zostawia ją
  // niewidoczną w discovery/pairing mimo PAID (brak self-heal). cascadeBulkEnableAccountStatus
  // lift'uje ACTIVE tylko dla is_active+deleted_at:null+PAID (WHERE no-opuje disabled/soft-deleted —
  // nie odbanowuje), parytet lockstep z bulk-op (adminBulkChangePlan_IO) i CAN_USER_HAVE_ACTIVE_ACCOUNT.
  try {
    await DB_CLIENT.use.$transaction(async tx => {
      await cascadeBulkEnableAccountStatus(tx, [target_id]);
    });
  } catch (error) {
    return databaseFailure('adminChangePricingPlan_IO:reactivate', error);
  }

  // DECISION (nie usuwaj tego komentarza) — orphaned-sub guard: gdy admin ustawia
  // FREE na koncie z żywą subskrypcją Stripe, sam zapis DB (pricing_plan=FREE) NIE
  // anuluje subskrypcji — Stripe DALEJ bilinguje = realny wyciek pieniędzy (ghost
  // double-billing). Reużywamy cancelStripeSubscriptionIfExists (ta sama best-effort
  // ścieżka co delete-path L150): sama czyta subscription_id z DB (no-op gdy brak
  // subskrypcji), never-throws, retry+idempotent+critical-alert na trwałej awarii.
  // Tylko dla FREE — downgrade paid→paid idzie proracją przez Stripe portal/checkout,
  // NIE tędy. Wywołane PO mutacji: subscription_id przeżywa (setPaymentState go nie
  // czyści), a następujący webhook customer.subscription.deleted domknie stan (FREE/
  // UNPAID/CANCELED + wyczyszczony subscription_id).
  if (pricing_plan === PricingPlanValue.FREE) {
    await cancelStripeSubscriptionIfExists(target_id);
  }

  // DECISION (nie usuwaj tego komentarza) — asymetria admin-override vs Stripe-webhook
  // (świadoma, owner-only): admin_plan_override chroni pinowany plan TYLKO przed
  // login-time syncAccountWithStripe (stripe-sync.operations.ts L69 early-return).
  // Webhook-SSOT updateAccountPlanStatus (plan-status-update.operations.ts) pisze
  // pricing_plan BEZWARUNKOWO (nie czyta override) — realny customer.subscription.updated
  // nadpisze ręcznie nadany plan. To NIE bug: admin plan-change celuje w (a) comps/grants
  // na kontach BEZ Stripe-sub (żaden webnhook nigdy nie nadejdzie → override trzyma na
  // zawsze), (b) downgrade do FREE (powyżej anulujemy sub → nie będzie kolejnych webhooków).
  // Pinowanie override PONAD żywą płacącą subskrypcją jest z założenia kruche i NIE jest
  // wspieranym scenariuszem. Webhook payment-core zostaje Stripe-authoritative — NIE
  // dodajemy override-gate do updateAccountPlanStatus pre-launch (ryzyko regresu w
  // payment-core > korzyść z domknięcia niewspieranego przypadku).

  // OWNER-001: admin_plan_override jest ustawiany ATOMOWO wewnątrz
  // setPaymentStateByUserID_IO (ten sam nested stylist_account.update co
  // pricing_plan/payment_status), by login-time syncAccountWithStripe nie cofnął
  // planu. Wcześniej był osobnym, nieatomowym zapisem po setPaymentState — awaria
  // między płatnością a override zostawiała plan PAID bez flagi (silent revert na
  // następnym loginie + mylące 500 do admina mimo zmienionego planu).
  try {
    await emitAdminUserAudit(
      APP_EVENTS.INFO.ACCOUNT.PRICING_PLAN_CHANGED,
      currentUser.id,
      {
        target_id,
        old_plan: oldPlan,
        new_plan: pricing_plan,
        changed_by_admin: true,
        admin_plan_override_set: true,
        changed_at: new Date(),
      }
    );
  } catch (error) {
    return databaseFailure('adminChangePricingPlan_IO:audit', error);
  }

  return success(undefined);
};
