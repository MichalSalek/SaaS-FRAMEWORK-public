import type { Prisma } from '../../../prisma/js-client';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { hasCode } from '@kernel/models/type_narrowing';
import {
  AccountStatusValue,
  PaymentStatusValue,
  AccountTypeValue,
} from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { DEFAULT_EMAIL_PREFERENCES } from '@kernel/models/email/email.dto';
import {
  isValidAccountType,
  type AccountType,
} from '@kernel/domain/user-and-account/role_switch.config';
import { reconcileActiveRole } from './reconcile-active-role.helper';
import { assignAutoVanityUrl_IO } from '@domain/account/vanity-url.auto';

/**
 * Stamp the FIRST acceptance of terms + the 16+ declaration (owner 2026-09-24:
 * consents live in the database, not only in the browser gate). Only on an
 * explicit `true` from the request, only while the column is empty, so a
 * second role activation never moves the original date. Same transaction as
 * the account write: onboarding and its consent record succeed together.
 * Rationale: docs/DOMAIN/SCHEMA_DECISIONS.md#user-terms-accepted-at
 */
const recordTermsAcceptance = async (
  tx: Prisma.TransactionClient,
  userId: string,
  termsAccepted: boolean
): Promise<void> => {
  if (!termsAccepted) {
    return;
  }
  await tx.user.updateMany({
    where: { id: userId, terms_accepted_at: null },
    data: { terms_accepted_at: new Date() },
  });
};

/**
 * Onboard user as stylist — idempotent (returns success if account exists)
 *
 * DECISION (nie usuwaj tego komentarza):
 * Find-or-create stylist_account ORAZ reconcile aktywnej roli (account_type + role_id)
 * dzieja sie w JEDNEJ transakcji i reconcile biegnie BEZWARUNKOWO — takze gdy konto juz
 * istnieje. Wczesniej istnienie konta robilo early-return PRZED zapisem roli (cichy no-op:
 * 200 *_ACCOUNT_CREATED bez zmiany RBAC), a sciezka create pisala tylko role_id pomijajac
 * account_type (split-brain session DTO vs RBAC -> soft lockout). Mirror switchRole.
 */
export const onboardAsStylist_IO = async ({
  userId,
  displayName,
  addressCity,
  phone,
  emailMarketing,
  instagramHandle,
  termsAccepted = false,
}: {
  userId: string;
  displayName: string | null;
  addressCity: string | null;
  phone?: string | null | undefined;
  emailMarketing: boolean;
  /** Optional, kernel-validated (no „@”); empty string = none. */
  instagramHandle?: string | null | undefined;
  /** Explicit terms + 16+ consent from the request (recordTermsAcceptance). */
  termsAccepted?: boolean;
}): Promise<OperationResult<{ stylist_account_id: string }, DatabaseError>> => {
  const igHandle = instagramHandle?.trim() || null;
  try {
    const { stylistAccount, created } = await DB_CLIENT.use.$transaction(
      async tx => {
        let account = await tx.stylistAccount.findUnique({
          where: { created_by_user_id: userId },
        });

        const wasCreated = !account;
        if (!account) {
          account = await tx.stylistAccount.create({
            data: {
              created_by_user_id: userId,
              display_name: displayName,
              address_city: addressCity,
              phone: phone || null,
              instagram_handle: igHandle,
              pricing_plan: PricingPlanValue.FREE,
              payment_status: PaymentStatusValue.UNPAID,
              account_status: AccountStatusValue.ACTIVE,
              stripe_customer_id: null,
              subscription_id: null,
              subscription_status: null,
              vanity_url: null,
              latitude: null,
              longitude: null,
              // DECISION (PRMA email_preferences Phase 2, 2026-05-27):
              // Writes both JSON shadow (rollback) + typed Boolean columns (primary read path).
              // Phase 3 (separate PR) — drop JSON column po zweryfikowaniu zero rollback need.
              // DECISION (nie usuwaj tego komentarza):
              // marketing pochodzi z onboardingowej zgody stylistki (Step 1, opt-in,
              // domyślnie OFF) — NIE ze stałego DEFAULT_EMAIL_PREFERENCES.marketing.
              // JSON shadow musi być spójny z kolumną email_marketing (oba czytają
              // ten sam consent). trial_sequence zostaje na defaultcie (true).
              email_preferences: {
                ...DEFAULT_EMAIL_PREFERENCES,
                marketing: emailMarketing,
              },
              email_marketing: emailMarketing,
              email_trial_sequence: DEFAULT_EMAIL_PREFERENCES.trial_sequence,
            },
          });
        } else {
          // Account already existed (re-onboarding, or a stylist account created
          // earlier via switch-role auto-provision where the column defaults to true
          // without capturing consent). Re-apply the EXPLICIT onboarding marketing
          // choice so an opt-out is never silently dropped — onboarding is the single
          // consent-capture point regardless of account pre-existence. trial_sequence
          // preserved from the authoritative column (JSON shadow kept consistent).
          // Re-submitted onboarding = her latest data: an edit made after
          // Back (name, city, phone, Instagram) is saved, not dropped. Optional
          // fields left empty never wipe what the account already has.
          account = await tx.stylistAccount.update({
            where: { created_by_user_id: userId },
            data: {
              ...(displayName ? { display_name: displayName } : {}),
              ...(addressCity ? { address_city: addressCity } : {}),
              ...(phone ? { phone } : {}),
              ...(igHandle ? { instagram_handle: igHandle } : {}),
              email_marketing: emailMarketing,
              email_preferences: {
                trial_sequence: account.email_trial_sequence,
                marketing: emailMarketing,
              },
            },
          });
        }

        // Reconcile role on EVERY path (also when account already existed) so the
        // onboarding success-event is never a lie and RBAC always matches the session DTO.
        await reconcileActiveRole(tx, userId, AccountTypeValue.STYLIST);
        await recordTermsAcceptance(tx, userId, termsAccepted);

        return { stylistAccount: account, created: wasCreated };
      }
    );

    // Public profile link ready at once (DECISION in vanity-url.auto.ts). Also
    // on re-onboarding: it only fills an EMPTY address, never replaces one.
    if (!stylistAccount.vanity_url) {
      await assignAutoVanityUrl_IO(stylistAccount.account_id, [
        igHandle,
        displayName,
      ]);
    }
    if (created) {
      reportIssueBackend({
        namespace: 'onboardAsStylist',
        message: `User onboarded as stylist`,
        payload: {
          user_id: userId,
          stylist_account_id: stylistAccount.account_id,
        },
        mode: 'info',
      });
    }

    return success({ stylist_account_id: stylistAccount.account_id });
  } catch (error: unknown) {
    // P2002: concurrent caller created the account between our findUnique and create.
    // Re-fetch AND reconcile role to fulfil the idempotent contract — the account now
    // exists and the user must still end up in the stylist role.
    if (hasCode(error) && error.code === 'P2002') {
      const healed = await DB_CLIENT.use.$transaction(async tx => {
        const existing = await tx.stylistAccount.findUnique({
          where: { created_by_user_id: userId },
        });
        if (!existing) {
          return null;
        }
        await reconcileActiveRole(tx, userId, AccountTypeValue.STYLIST);
        // The racing writer may have been a path without consent (switch-role
        // auto-provision): this request's explicit acceptance still counts.
        await recordTermsAcceptance(tx, userId, termsAccepted);
        return existing;
      });
      if (healed) {
        return success({ stylist_account_id: healed.account_id });
      }
    }
    return databaseFailure('onboardAsStylist', error);
  }
};

/**
 * Onboard user as client — idempotent (returns success if account exists)
 *
 * DECISION (nie usuwaj tego komentarza):
 * Find-or-create client_account ORAZ reconcile aktywnej roli (account_type + role_id)
 * w JEDNEJ transakcji, reconcile BEZWARUNKOWO (takze gdy konto juz istnieje). Wczesniej
 * existing-account path lecial prosto do return success() pomijajac zapis roli (cichy
 * no-op), a create-path pisal tylko role_id pomijajac account_type (split-brain). Mirror
 * switchRole — zob. reconcile-active-role.helper.ts.
 */
export const onboardAsClient_IO = async ({
  userId,
  termsAccepted = false,
}: {
  userId: string;
  /** Explicit terms + 16+ consent from the request (recordTermsAcceptance). */
  termsAccepted?: boolean;
}): Promise<OperationResult<{ client_account_id: string }, DatabaseError>> => {
  try {
    const { clientAccount, created } = await DB_CLIENT.use.$transaction(
      async tx => {
        let account = await tx.clientAccount.findUnique({
          where: { created_by_user_id: userId },
        });

        const wasCreated = !account;
        if (!account) {
          account = await tx.clientAccount.create({
            data: { created_by_user_id: userId },
          });
        }

        // Reconcile role on EVERY path (also when account already existed) so the
        // onboarding success-event is never a lie and RBAC always matches the session DTO.
        await reconcileActiveRole(tx, userId, AccountTypeValue.CLIENT);
        await recordTermsAcceptance(tx, userId, termsAccepted);

        return { clientAccount: account, created: wasCreated };
      }
    );

    if (created) {
      reportIssueBackend({
        namespace: 'onboardAsClient',
        message: `User onboarded as client`,
        payload: {
          user_id: userId,
          client_account_id: clientAccount.client_account_id,
        },
        mode: 'info',
      });
    }

    return success({ client_account_id: clientAccount.client_account_id });
  } catch (error: unknown) {
    // P2002: concurrent caller created the account between our findUnique and create.
    // Re-fetch AND reconcile role to fulfil the idempotent contract — the account now
    // exists and the user must still end up in the client role.
    if (hasCode(error) && error.code === 'P2002') {
      const healed = await DB_CLIENT.use.$transaction(async tx => {
        const existing = await tx.clientAccount.findUnique({
          where: { created_by_user_id: userId },
        });
        if (!existing) {
          return null;
        }
        await reconcileActiveRole(tx, userId, AccountTypeValue.CLIENT);
        // The racing writer may have been a path without consent (switch-role
        // auto-provision): this request's explicit acceptance still counts.
        await recordTermsAcceptance(tx, userId, termsAccepted);
        return existing;
      });
      if (healed) {
        return success({ client_account_id: healed.client_account_id });
      }
    }
    return databaseFailure('onboardAsClient', error);
  }
};

/**
 * Switch role with auto-provisioning — transactional
 *
 * DECISION (nie usuwaj tego komentarza) — 2026-09-25: przełączenie na CLIENT NIE
 * zdejmuje publicznego profilu stylistki. Zmiana roli to przełącznik TRYBU dla
 * użytkowniczki z dwiema rolami, a nie odejście z roli stylistki: StylistAccount
 * zostaje ACTIVE, więc wizytówka, jej udostępnione linki, wydrukowany QR i wpis
 * w sitemapie działają dalej. Ukrywanie przy każdym przełączeniu łamałoby linki
 * i SEO, a powrót to jeden tap. Profil zdejmuje usunięcie konta (soft-delete,
 * DOMAIN_SSOT §13.1 — STYLIST_PUBLICLY_VISIBLE odcina is_active=false) albo jego
 * dezaktywacja (USER_DISABLE_SELF); TREŚĆ wizytówki (przypięte prace, opis,
 * kontakt) stylistka zdejmuje w ustawieniach profilu (`/app/profile`). Osobnego
 * przełącznika „ukryj profil" dziś nie ma — gdyby powstał, mieszka tam, nie tu.
 * Nie dokładaj tu ukrywania profilu „dla spójności".
 */
export const switchRole_IO = async ({
  userId,
  targetAccountType,
}: {
  userId: string;
  targetAccountType: AccountType;
}): Promise<
  OperationResult<
    { success: true; account_type: AccountType },
    DatabaseError | ValidationError
  >
> => {
  if (!isValidAccountType(targetAccountType)) {
    reportIssueBackend({
      namespace: 'switchRole',
      message: 'Invalid account type',
      payload: { targetAccountType },
      mode: 'error',
    });
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'account_type',
      message: `Invalid account type: ${targetAccountType}`,
    });
  }

  try {
    await DB_CLIENT.use.$transaction(async tx => {
      if (targetAccountType === AccountTypeValue.STYLIST) {
        const existingAccount = await tx.stylistAccount.findUnique({
          where: { created_by_user_id: userId },
        });
        if (!existingAccount) {
          await tx.stylistAccount.create({
            data: {
              created_by_user_id: userId,
              pricing_plan: PricingPlanValue.FREE,
              payment_status: PaymentStatusValue.UNPAID,
              account_status: AccountStatusValue.ACTIVE,
            },
          });
        }
      } else if (targetAccountType === AccountTypeValue.CLIENT) {
        const existingAccount = await tx.clientAccount.findUnique({
          where: { created_by_user_id: userId },
        });
        if (!existingAccount) {
          await tx.clientAccount.create({
            data: { created_by_user_id: userId },
          });
        }
      }

      // Single canonical role mutator shared with onboardAsStylist/onboardAsClient
      // (RULE OF THREE) — writes account_type + role_id atomically, no drift.
      await reconcileActiveRole(tx, userId, targetAccountType);
    });
  } catch (error: unknown) {
    // P2002: concurrent caller created the target account between our findUnique
    // and create. Re-fetch the matching account AND reconcile role in one tx to
    // fulfil the idempotent contract — the account now exists and the user must
    // still end up in the target role. Mirror onboardAsStylist/onboardAsClient,
    // but branch on targetAccountType and return switchRole's success shape.
    if (hasCode(error) && error.code === 'P2002') {
      const healed = await DB_CLIENT.use.$transaction(async tx => {
        const existing =
          targetAccountType === AccountTypeValue.STYLIST
            ? await tx.stylistAccount.findUnique({
                where: { created_by_user_id: userId },
              })
            : await tx.clientAccount.findUnique({
                where: { created_by_user_id: userId },
              });
        if (!existing) {
          return false;
        }
        await reconcileActiveRole(tx, userId, targetAccountType);
        return true;
      });
      if (healed) {
        return success({ success: true, account_type: targetAccountType });
      }
    }
    return databaseFailure('switchRole', error);
  }

  return success({ success: true, account_type: targetAccountType });
};
