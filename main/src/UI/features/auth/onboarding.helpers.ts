// UI/features/auth/onboarding.helpers.ts
// Pure helpers extracted from OnboardingPage (keeps the page under the 300-line
// cap). No React — plain functions over the onboarding form shape.

import type { UseFormReturn } from 'react-hook-form';
import {
  VALIDATION_REGEX,
  VALIDATION_SOCIAL,
} from '@kernel/policies/validation.config';
import type { SafeCurrentUser } from '@kernel/models/session/session.dto';
import {
  ONBOARDING_STEP,
  STEP_SEQUENCE_CLIENT,
  STEP_SEQUENCE_STYLIST,
  type OnboardingFormValues,
  type OnboardingRole,
} from './onboarding.types';

export function isOnboardingRole(value: unknown): value is OnboardingRole {
  return value === 'stylist' || value === 'client';
}

/** Reads `?role=stylist|client` from the URL (intent passed from registration). */
export function readPrefilledRole(
  query: Record<string, string | string[] | undefined>
): OnboardingRole | null {
  const raw = Array.isArray(query.role) ? query.role[0] : query.role;
  return isOnboardingRole(raw) ? raw : null;
}

/**
 * Role implied by the accounts the user ALREADY has. Seeds the pristine role
 * field when nothing stronger arrived (`?role=` or a pricing funnel), so the
 * welcome step speaks to the right person before the role step is reached.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Sygnałem jest POSIADANE konto, nie `account_type`. Kolumna ma default CLIENT,
 * więc każde świeże konto po rejestracji (oba konta null) „jest klientką" i
 * wtedy podpowiedź wyłączyłaby domyślny lejek stylistki. Istniejący
 * StylistAccount wygrywa z ClientAccount: na onboarding trafia wtedy przez
 * bramkę planu (useOnboardingPlanGuard, `plan-unresolved`), a z niej wyprowadza
 * wyłącznie wybór planu. Podpowiedź „klientka" zamknęłaby taką osobę w pętli
 * onboarding → /app → onboarding. Samo ClientAccount = klientka, która weszła tu
 * ręcznie: dostaje copy klientki, nie „Prowadzisz tu galerię swoich prac" (S122).
 */
export function roleHintFromAccounts(
  user: Pick<SafeCurrentUser, 'stylist_account' | 'client_account'> | undefined
): OnboardingRole | null {
  if (user === undefined) {
    return null;
  }
  if (user.stylist_account !== null) {
    return 'stylist';
  }
  if (user.client_account !== null) {
    return 'client';
  }
  return null;
}

/**
 * Account-derived role → pristine role field. Weakest source of the three:
 * an explicit `?role=` and a pricing funnel (stylist intent, applyFunnelPrefill)
 * both win, and so does anything the user already touched.
 */
export function applyAccountRoleHint(
  methods: UseFormReturn<OnboardingFormValues>,
  hint: OnboardingRole | null,
  prefilledRole: OnboardingRole | null,
  hasFunnel: boolean
): void {
  if (hint === null || prefilledRole !== null || hasFunnel) {
    return;
  }
  if (!methods.getFieldState('role').isDirty) {
    methods.setValue('role', hint);
  }
}

/**
 * Whether the chosen role pays during onboarding. Stylists pick a plan + pay
 * (embedded checkout, Step 5); clients never pick a paid plan — they have no
 * billing surface — so their flow ends one step earlier.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Until a role is picked we assume the LONGER (stylist) flow so the stepper does
 * not visibly shrink the instant the user lands on the role step — collapsing the
 * count mid-flow reads as a glitch. The real branch resolves the moment a role
 * card is selected.
 */
export function selectsPlan(role: OnboardingFormValues['role']): boolean {
  return role !== 'client';
}

/**
 * The ordered step-id sequence for the active flow (SSOT for length + nav).
 *
 * DECISION (nie usuwaj tego komentarza):
 * `withCheckout` = the stylist arrived with an EXPLICIT plan choice (a plan card
 * on /pricing or a plan link from an email). Only then does onboarding end on
 * the plan + payment step. Without it the stylist starts on Free straight after
 * PREFERENCES and the trial is offered later in the app (free-first entry, owner
 * 2026-09-23, DOMAIN_SSOT §18).
 */
export function stepSequenceForRole(
  role: OnboardingFormValues['role'],
  withCheckout = true
): readonly number[] {
  if (!selectsPlan(role)) {
    return STEP_SEQUENCE_CLIENT;
  }
  return withCheckout
    ? STEP_SEQUENCE_STYLIST
    : STEP_SEQUENCE_STYLIST.filter(step => step !== ONBOARDING_STEP.CHECKOUT);
}

/** Total steps for the active flow (role-dependent — derived from the sequence). */
export function totalStepsForRole(
  role: OnboardingFormValues['role'],
  withCheckout = true
): number {
  return stepSequenceForRole(role, withCheckout).length;
}

/**
 * 1-indexed DISPLAY position of a step within the active flow. Differs from the
 * step id for clients (who skip BASIC_INFO), so the stepper orb + hero pill show
 * a contiguous "N of M" while step ids stay semantic. Unknown step → 1.
 */
export function stepPositionForRole(
  step: number,
  role: OnboardingFormValues['role'],
  withCheckout = true
): number {
  const index = stepSequenceForRole(role, withCheckout).indexOf(step);
  return index < 0 ? 1 : index + 1;
}

/** Next step id in the active flow (clamped at the last step). */
export function nextStep(
  step: number,
  role: OnboardingFormValues['role'],
  withCheckout = true
): number {
  const seq = stepSequenceForRole(role, withCheckout);
  const index = seq.indexOf(step);
  if (index < 0 || index >= seq.length - 1) {
    return step;
  }
  return seq[index + 1] ?? step;
}

/** Previous step id in the active flow (clamped at the first step). */
export function prevStep(
  step: number,
  role: OnboardingFormValues['role'],
  withCheckout = true
): number {
  const seq = stepSequenceForRole(role, withCheckout);
  const index = seq.indexOf(step);
  if (index <= 0) {
    return seq[0] ?? step;
  }
  return seq[index - 1] ?? step;
}

/** Step → fields-to-validate map (RHF trigger before "Continue"). */
export function fieldsForStep(
  step: number,
  role: OnboardingFormValues['role']
): (keyof OnboardingFormValues)[] {
  if (step === ONBOARDING_STEP.ROLE) {
    // RODO Art. 6(1)(a): terms_accepted must be true before we collect any
    // PII (which starts in the basic-info step: display_name, address_city,
    // phone). The age-16 declaration is merged into terms_accepted;
    // marketing_consent is OPTIONAL (stylist-only opt-in) so it is intentionally
    // NOT validated here.
    return ['role', 'terms_accepted'];
  }
  if (step === ONBOARDING_STEP.BASIC_INFO) {
    const base: (keyof OnboardingFormValues)[] = [
      'display_name',
      'address_city',
    ];
    if (role === 'stylist') {
      base.push('phone', 'instagram_handle');
    }
    return base;
  }
  // WELCOME, PREFERENCES, CHECKOUT carry no synchronous field gate.
  return [];
}

/**
 * Funnel-intent → pristine form fields (S76; wydzielone z composition pod
 * max-lines). Dirty-wybór usera i jawne `?role=` ZAWSZE wygrywają; plan/billing
 * nadpisują tylko nietknięte pola (kanon efektu funnel-sync). Prefill roli:
 * funnel planu = deklaracja ścieżki STYLISTKI (klasa S59 — nie gub intencji).
 */
export function applyFunnelPrefill(
  methods: UseFormReturn<OnboardingFormValues>,
  funnel: {
    planId: NonNullable<OnboardingFormValues['selected_plan_id']>;
    billingPeriod: OnboardingFormValues['billing_period'];
  } | null,
  prefilledRole: OnboardingRole | null
): void {
  if (funnel === null) {
    return;
  }
  if (!methods.getFieldState('selected_plan_id').isDirty) {
    methods.setValue('selected_plan_id', funnel.planId);
  }
  if (!methods.getFieldState('billing_period').isDirty) {
    methods.setValue('billing_period', funnel.billingPeriod);
  }
  if (prefilledRole === null && !methods.getFieldState('role').isDirty) {
    methods.setValue('role', 'stylist');
  }
}

/**
 * Raw Instagram input -> bare account name: trims, drops a leading „@” and
 * unwraps a pasted profile URL (`https://www.instagram.com/anna.nails/?hl=pl`
 * -> `anna.nails`). Stylists copy the link from the app as often as they type
 * the name. Empty string = no handle.
 */
export function normalizeInstagramHandle(raw: string): string {
  const trimmed = raw.trim();
  const path = /instagram\.com\/([^?#\s]*)/i.exec(trimmed)?.[1];
  if (path === undefined) {
    return trimmed.replace(/^@+/, '');
  }
  const [first = '', second = ''] = path.split('/');
  // A story link carries the account (`/stories/<name>/<id>`). A post, reel or
  // share link carries no account name at all: keep the raw input so the field
  // shows its format error instead of storing `reel` or `p` as her handle.
  if (first.toLowerCase() === 'stories') {
    return second.replace(/^@+/, '');
  }
  if (INSTAGRAM_NON_ACCOUNT_PATHS.has(first.toLowerCase())) {
    return trimmed;
  }
  return first.replace(/^@+/, '');
}

/** First path segments of instagram.com that are not an account name. */
const INSTAGRAM_NON_ACCOUNT_PATHS: ReadonlySet<string> = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'explore',
  'accounts',
  'direct',
  'share',
  's',
  '',
]);

/** Kernel rules (same as the profile editor): Instagram charset, max 30. */
export function isValidInstagramHandle(handle: string): boolean {
  return (
    handle.length <= VALIDATION_SOCIAL.INSTAGRAM_HANDLE_MAX &&
    VALIDATION_REGEX.INSTAGRAM_HANDLE.test(handle)
  );
}
