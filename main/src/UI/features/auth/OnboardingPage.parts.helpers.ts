// UI/features/auth/OnboardingPage.parts.helpers.ts
// Non-React helpers extracted from OnboardingPage.composition (keeps the page
// under the 300-line cap). Top-bar title and intro-card copy resolution +
// focus-management for failed step validation. Type-only deps on next-intl / react-hook-form (no runtime
// React), so this stays a plain `.ts`.

import type { KeyboardEvent } from 'react';
import type { useTranslations } from 'next-intl';
import type { useForm } from 'react-hook-form';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';

import { pushNewSnackbar } from '../../../application/app-snackbar/appSnackbar.possibilities.api';
import { updateNotificationPreferences_IO } from '../../../domain/user/userIO.possibilities.api';
import {
  isOnboardingRole,
  normalizeInstagramHandle,
} from './onboarding.helpers';
import type { CompleteOnboardingVariables } from './hooks/useCompleteOnboarding';
import {
  ONBOARDING_DEFAULTS,
  ONBOARDING_STEP,
  type OnboardingFormValues,
} from './onboarding.types';

export type OnboardingT = ReturnType<
  typeof useTranslations<'pages.onboarding'>
>;

/**
 * Persist the notification-preference toggle — but ONLY when the user changed it
 * from the onboarding default. users.notifications_enabled already defaults `true`
 * at registration (= ONBOARDING_DEFAULTS.notifications_on), so an UNCHANGED toggle
 * is a redundant no-op write whose backend success event would toast „Preferencje
 * powiadomień zaktualizowane" ON the terminal onboarding success view — doubling
 * with the account-created confirmation into a two-toast pile-up (klasa S51c:
 * command-event z własnym UI-feedbackiem — tu feedbackiem jest ekran „Wszystko
 * gotowe"). Skipping the no-op leaves ZERO toasts on the common leave-default
 * path; a deliberate opt-out (toggle OFF) still persists AND keeps its single,
 * correct „zaktualizowane" toast. Guard depends on the invariant
 * ONBOARDING_DEFAULTS.notifications_on === users.notifications_enabled column
 * default (both `true`); keep them in lock-step.
 *
 * Non-blocking fire-and-forget — it must NOT gate the happy-path advance (the
 * account already exists). Idempotent, so it is safe to call on EVERY
 * leave-of-PREFERENCES, including a Back-visit re-advance where the onboard
 * mutation is skipped (otherwise a toggle changed on that visit would be dropped).
 * DECISION (nie usuwaj tego komentarza): błąd NIE jest niemy — updateNotificationPreferences_IO
 * przechodzi przez HTTP interceptor (event-bus Stage 1), który toastuje porażkę (backendowy
 * event lub INTERNET_CONNECTION_PROBLEM). Pusty `.catch` tylko połyka rejection tego
 * fire-and-forget promise'a (bez niego unhandled-rejection); lokalny push byłby duplikatem
 * toasta interceptora — parytet z NotificationPrefsSection (też interceptor-owned).
 */
export function syncNotificationPreferenceIfChanged(enabled: boolean): void {
  if (enabled === ONBOARDING_DEFAULTS.notifications_on) {
    return;
  }
  void updateNotificationPreferences_IO({
    notifications_enabled: enabled,
  }).catch(() => {
    // Interceptor already surfaced the error toast; swallow to avoid an
    // unhandled rejection on this fire-and-forget call.
  });
}

/** Top-bar title. WELCOME has its own (shown once the intro card scrolls out
 *  of view), every later step shows the name of the PROCESS: the step's name
 *  is the step indicator's line, so the bar must not repeat it. Success is
 *  terminal (no card), so its title shows straight away. */
export function onboardingNavTitle(
  step: number,
  showSuccess: boolean,
  t: OnboardingT
): string {
  if (showSuccess) {
    return t('navTitleSuccess');
  }
  return step === ONBOARDING_STEP.WELCOME
    ? t('navTitleWelcome')
    : t('processTitle');
}

/** Copy of the WELCOME intro card (title + accent + one sentence). */
export function welcomeHeroCopy(
  role: OnboardingFormValues['role'],
  t: OnboardingT
): { title: string; accent: string; subtitle: string } {
  // Welcome renders before the role step, so role is usually '' here — the
  // stylist copy is the default funnel. When a client arrived with a
  // prefilled ?role=client (dashboard hint) or already owns a ClientAccount
  // (roleHintFromAccounts), branch to client-correct copy (no "your
  // studio", no trial/card reassurance a client never faces).
  return role === 'client'
    ? {
        title: t('heroTitleWelcomeClient'),
        accent: t('heroAccentWelcomeClient'),
        subtitle: t('heroSubtitleWelcomeClient'),
      }
    : {
        title: t('heroTitleWelcome'),
        accent: t('heroAccentWelcome'),
        subtitle: t('heroSubtitleWelcome'),
      };
}

/**
 * Defense-in-depth replay bramek kroku ROLA (rola wybrana + zgody terms/16+)
 * tuż przed submitem onboardingu — RHF wymusza je na „Dalej", ale user, który
 * przełączy stan PO ich przejściu, nie może dojechać do backendu bez zgody.
 * `false` = flow odbity do kroku ROLA (przez `backToRoleStep`).
 */
export function ensureOnboardingConsent(
  values: OnboardingFormValues,
  t: OnboardingT,
  backToRoleStep: () => void
): boolean {
  if (!isOnboardingRole(values.role)) {
    pushNewSnackbar(t('toastRoleError'), 'error');
    backToRoleStep();
    return false;
  }
  if (!values.terms_accepted) {
    backToRoleStep();
    return false;
  }
  return true;
}

/** On a failed "Continue", point the eye at the first errored field. */
export function focusFirstError(
  methods: ReturnType<typeof useForm<OnboardingFormValues>>,
  fields: (keyof OnboardingFormValues)[]
): void {
  // CLR (martwy tap walidacji): a failed "Next" on a 390px screen must point the
  // eye at what's missing, not bounce silently. Two-pronged:
  //  1) setFocus on the first errored REGISTERED field (text inputs land the
  //     caret + pop the mobile keyboard). Wrapped in try/catch because
  //     Controller-backed fields (role/terms) have no native ref → setFocus
  //     would throw.
  //  2) scrollIntoView the first error message ([role=alert]) — the reliable
  //     carrier for Controller fields. Deferred a frame so the freshly set error
  //     nodes are painted before we query.
  const errors = methods.formState.errors;
  const firstErrored = fields.find(name => errors[name] !== undefined);
  if (firstErrored !== undefined) {
    try {
      methods.setFocus(firstErrored, { shouldSelect: true });
    } catch {
      /* Controller field (no ref) — scroll fallback below handles it. */
    }
  }
  if (typeof window !== 'undefined') {
    window.requestAnimationFrame(() => {
      const firstAlert = document.querySelector<HTMLElement>('[role="alert"]');
      firstAlert?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
}

/**
 * Trzy settery pól planu, jedną fabryką (wydzielone z kompozycji, S123).
 *
 * `shouldDirty` na KAŻDYM z nich jest warunkiem poprawności, nie kosmetyką:
 * efekt `applyFunnelPrefill` nadpisuje wyłącznie pola NIETKNIĘTE, więc bez
 * oznaczenia świeżego wyboru jako brudnego ponowny przebieg efektu przywracał
 * plan z lejka cennika na wierzch decyzji użytkowniczki (kanon dirty-wins,
 * S82). Dotyczy tak samo furtki Free, jak wyboru karty i cyklu rozliczeń.
 *
 * Furtka Free trzyma wybór W FORMULARZU, a nie w osobnym stanie, bo
 * `selected_plan_id` jest polem obserwowanym, które kompozycja podaje wprost do
 * panelu płatności: drugi nośnik tej samej decyzji od razu by się rozjechał.
 */
export function makePlanFieldSetters(
  methods: ReturnType<typeof useForm<OnboardingFormValues>>
): {
  handleStartFree: () => void;
  handleSelectPlan: (plan: PricingPlan) => void;
  handleSelectBilling: (period: BillingPeriod) => void;
} {
  return {
    handleStartFree: () =>
      methods.setValue('selected_plan_id', PricingPlanValue.FREE, {
        shouldDirty: true,
      }),
    handleSelectPlan: plan =>
      methods.setValue('selected_plan_id', plan, { shouldDirty: true }),
    handleSelectBilling: period =>
      methods.setValue('billing_period', period, { shouldDirty: true }),
  };
}

/**
 * Enter (and the mobile keyboard's "Dalej"/"Gotowe" key, which sends Enter) in
 * an onboarding text field. Mirrors a native form: Enter moves to the next
 * text field; Enter in the LAST one runs the same advance as the "Dalej"
 * button (same validation). A multi-field form without a submit button gets no
 * implicit submission, so before 2026-09-23 the key did nothing and the only
 * way on was the sticky button, which a mobile keyboard can cover. The
 * 2026-09-02 stylist filled name, city and phone and left without advancing.
 */
export function advanceOnEnterKey(
  event: KeyboardEvent<HTMLFormElement>,
  onAdvance: () => void
): void {
  const target = event.target;
  if (
    event.key !== 'Enter' ||
    event.nativeEvent.isComposing ||
    !(target instanceof HTMLInputElement) ||
    !TEXT_ENTRY_TYPES.has(target.type)
  ) {
    return;
  }
  event.preventDefault();
  const fields = Array.from(
    event.currentTarget.querySelectorAll<HTMLInputElement>('input')
  ).filter(el => TEXT_ENTRY_TYPES.has(el.type) && !el.disabled);
  const nextIndex = fields.indexOf(target) + 1;
  if (nextIndex > 0 && nextIndex < fields.length) {
    fields[nextIndex]?.focus();
    return;
  }
  onAdvance();
}

const TEXT_ENTRY_TYPES: ReadonlySet<string> = new Set([
  'text',
  'tel',
  'email',
  'search',
  'url',
]);

/** Form values -> the stylist onboard request (trimmed, empty = null). */
export function stylistOnboardPayload(
  values: OnboardingFormValues
): Extract<CompleteOnboardingVariables, { role: 'stylist' }> {
  const phone = values.phone.trim();
  const instagram = normalizeInstagramHandle(values.instagram_handle);
  return {
    role: 'stylist',
    display_name: values.display_name.trim(),
    address_city: values.address_city.trim(),
    phone: phone === '' ? null : phone,
    // Stylist-only marketing opt-in (role step). Persisted as
    // StylistAccount.email_marketing; clients have no marketing channel.
    email_marketing: values.marketing_consent,
    instagram_handle: instagram === '' ? null : instagram,
    // Recorded server-side as User.terms_accepted_at (first acceptance only).
    terms_accepted: values.terms_accepted,
  };
}

/** Form values -> the client onboard request (the consent is recorded). */
export function clientOnboardPayload(
  values: OnboardingFormValues
): Extract<CompleteOnboardingVariables, { role: 'client' }> {
  return { role: 'client', terms_accepted: values.terms_accepted };
}

/** Identity of the data the onboard mutation would send (re-entry check). */
export function stylistPayloadKey(values: OnboardingFormValues): string {
  return JSON.stringify(stylistOnboardPayload(values));
}
