import { readPersonalAvatarMirror } from './user-avatar.operations';
import { enrollFreeOnboarding_IO } from '@domain/email/operations/free-email.enrollment';
import { finishAcceptedSalonInvitations } from '@domain/salon-staff/salon-invitation-token.service';
import { recordTermsAcceptance } from './user-onboarding-consent.helper';
import { DB_CLIENT } from '@app/db/db.client';
import { lockStylistAccount } from '@app/db/lock-rows';
import type { EmailPreferences } from '@kernel/models/email/email.dto';
import { scheduleEmailPreferenceAudit } from '@domain/email/operations/email-preferences.audit';
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
import {
  lockUserForRoleChange,
  reconcileActiveRole,
} from './reconcile-active-role.helper';
import { assignAutoVanityUrl_IO } from '@domain/account/vanity-url.auto';
import { sanitizePublicBrandName } from '@domain/account/operations/account-settings.helper';

/**
 * Onboard user as stylist — idempotent (returns success if account exists)
 *
 * DECISION: find-or-create of stylist_account AND the active-role reconcile (account_type + role_id) run
 * in ONE transaction, and the reconcile runs UNCONDITIONALLY, also when the account already exists.
 * Before, an existing account early-returned before the role write (a silent no-op: 200 without an RBAC
 * change) and the create path wrote only role_id (session DTO vs RBAC split-brain). Mirrors switchRole.
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
  // The same cleaning as accountUpdateDisplayName_IO (DECISION in
  // account-settings.helper.ts): the public name loses zero-width characters
  // and stray whitespace. Nothing visible left = not given (null).
  const cleanDisplayName =
    displayName === null ? null : sanitizePublicBrandName(displayName) || null;
  const cleanAddressCity = addressCity?.trim() || null;
  try {
    const { stylistAccount, created, consentBefore } =
      await DB_CLIENT.use.$transaction(async tx => {
        await lockUserForRoleChange(tx, userId);
        let account = await tx.stylistAccount.findUnique({
          where: { created_by_user_id: userId },
        });

        const wasCreated = !account;
        let consentBefore: EmailPreferences | null = null;
        if (!account) {
          account = await tx.stylistAccount.create({
            data: {
              ...(await readPersonalAvatarMirror(tx, userId)),
              display_name: cleanDisplayName,
              address_city: cleanAddressCity,
              // Only a string reaches Prisma: an object here would be read as an operator.
              phone:
                typeof phone === 'string' && phone.length > 0 ? phone : null,
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
              // DECISION: writes both the JSON shadow (rollback) and the typed Boolean columns (primary read
              // path); the JSON column is dropped once no rollback is needed. `marketing` comes from the
              // stylist's onboarding opt-in (default OFF), NOT from DEFAULT_EMAIL_PREFERENCES.marketing, so
              // the JSON shadow agrees with the email_marketing column. trial_sequence stays at its default.
              email_preferences: {
                ...DEFAULT_EMAIL_PREFERENCES,
                marketing: emailMarketing,
              },
              email_marketing: emailMarketing,
              email_trial_sequence: DEFAULT_EMAIL_PREFERENCES.trial_sequence,
            },
          });
        } else {
          await lockStylistAccount(tx, account.account_id);
          account = await tx.stylistAccount.findUniqueOrThrow({
            where: { account_id: account.account_id },
          });
          consentBefore = {
            marketing: account.email_marketing,
            trial_sequence: account.email_trial_sequence,
          };
          // Account already existed (re-onboarding, or a stylist account created
          // earlier via switch-role auto-provision where the column defaults to true
          // without capturing consent). Re-apply the EXPLICIT onboarding marketing
          // choice so an opt-out is never silently dropped. Registration and later
          // prompts remain separate capture points. trial_sequence
          // preserved from the authoritative column (JSON shadow kept consistent).
          // Re-submitted onboarding = her latest data: an edit made after
          // Back (name, city, phone, Instagram) is saved, not dropped. Optional
          // fields left empty never wipe what the account already has.
          account = await tx.stylistAccount.update({
            where: { created_by_user_id: userId },
            data: {
              ...(cleanDisplayName ? { display_name: cleanDisplayName } : {}),
              ...(cleanAddressCity ? { address_city: cleanAddressCity } : {}),
              ...(typeof phone === 'string' && phone.length > 0
                ? { phone }
                : {}),
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
        await enrollFreeOnboarding_IO(tx, userId, account.account_id);

        return { stylistAccount: account, created: wasCreated, consentBefore };
      });
    scheduleEmailPreferenceAudit({
      userId,
      accountId: stylistAccount.account_id,
      source: 'registration',
      before: consentBefore,
      after: {
        marketing: emailMarketing,
        trial_sequence: stylistAccount.email_trial_sequence,
      },
    });

    // Public profile link ready at once (DECISION in vanity-url.auto.ts). Also
    // on re-onboarding: it only fills an EMPTY address, never replaces one.
    if (!stylistAccount.vanity_url) {
      await assignAutoVanityUrl_IO(stylistAccount.account_id, [
        igHandle,
        cleanDisplayName,
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

    await finishAcceptedSalonInvitations(userId, 'stylist account creation');
    return success({ stylist_account_id: stylistAccount.account_id });
  } catch (error: unknown) {
    // P2002: concurrent caller created the account between our findUnique and create.
    // Re-fetch AND reconcile role to fulfil the idempotent contract — the account now
    // exists and the user must still end up in the stylist role.
    if (hasCode(error) && error.code === 'P2002') {
      const healed = await DB_CLIENT.use.$transaction(async tx => {
        await lockUserForRoleChange(tx, userId);
        const existing = await tx.stylistAccount.findUnique({
          where: { created_by_user_id: userId },
        });
        if (!existing) {
          return null;
        }
        await lockStylistAccount(tx, existing.account_id);
        const before = await tx.stylistAccount.findUniqueOrThrow({
          where: { account_id: existing.account_id },
        });
        await tx.stylistAccount.update({
          where: { account_id: existing.account_id },
          data: {
            email_marketing: emailMarketing,
            email_preferences: {
              marketing: emailMarketing,
              trial_sequence: before.email_trial_sequence,
            },
          },
        });
        await reconcileActiveRole(tx, userId, AccountTypeValue.STYLIST);
        // The racing writer may have been a path without consent (switch-role
        // auto-provision): this request's explicit acceptance still counts.
        await recordTermsAcceptance(tx, userId, termsAccepted);
        await enrollFreeOnboarding_IO(tx, userId, existing.account_id);
        return {
          accountId: existing.account_id,
          before: {
            marketing: before.email_marketing,
            trial_sequence: before.email_trial_sequence,
          },
        };
      });
      if (healed) {
        scheduleEmailPreferenceAudit({
          userId,
          accountId: healed.accountId,
          source: 'registration',
          before: healed.before,
          after: { ...healed.before, marketing: emailMarketing },
        });
        await finishAcceptedSalonInvitations(
          userId,
          'stylist account creation'
        );
        return success({ stylist_account_id: healed.accountId });
      }
    }
    return databaseFailure('onboardAsStylist', error);
  }
};

/**
 * Onboard user as client — idempotent (returns success if account exists)
 *
 * DECISION: find-or-create of client_account AND the active-role reconcile run in ONE transaction, the
 * reconcile UNCONDITIONALLY (also for an existing account). Before, the existing-account path returned
 * early without the role write and the create path wrote only role_id (split-brain). Mirrors switchRole,
 * see reconcile-active-role.helper.ts.
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
        await lockUserForRoleChange(tx, userId);
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
        await lockUserForRoleChange(tx, userId);
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
 * DECISION: switching to CLIENT does NOT take down the stylist's public profile. A role change is a MODE
 * switch for a two-role user, not leaving the stylist role: StylistAccount stays ACTIVE, so the profile,
 * its shared links, the printed QR and the sitemap entry keep working (hiding on every switch would break
 * links and SEO, and coming back is one tap). The profile goes away on account deletion (soft-delete cuts
 * is_active=false via STYLIST_PUBLICLY_VISIBLE) or deactivation (USER_DISABLE_SELF); its CONTENT is removed
 * in profile settings (`/app/profile`). Do not add profile hiding here "for consistency".
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
      await lockUserForRoleChange(tx, userId);
      if (targetAccountType === AccountTypeValue.STYLIST) {
        const existingAccount = await tx.stylistAccount.findUnique({
          where: { created_by_user_id: userId },
        });
        if (!existingAccount) {
          await tx.stylistAccount.create({
            data: {
              ...(await readPersonalAvatarMirror(tx, userId)),
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
        await lockUserForRoleChange(tx, userId);
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
        if (targetAccountType === AccountTypeValue.STYLIST) {
          await finishAcceptedSalonInvitations(
            userId,
            'stylist account creation'
          );
        }
        return success({ success: true, account_type: targetAccountType });
      }
    }
    return databaseFailure('switchRole', error);
  }

  if (targetAccountType === AccountTypeValue.STYLIST) {
    await finishAcceptedSalonInvitations(userId, 'stylist account creation');
  }
  return success({ success: true, account_type: targetAccountType });
};
