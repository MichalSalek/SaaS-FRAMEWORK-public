// UI/features/auth/hooks/useOnboardingDraft.ts
//
// S123 — szkic onboardingu przeżywa wyjście z lejka.
//
// ZMIERZONY PROBLEM (flow-pass S123): onboarding trzyma cały stan w Reakcie, a
// `useOnboardingPlanGuard` zawraca stylistkę bez rozstrzygniętego planu na
// onboarding z KAŻDEJ trasy /app. Wystarczyło więc, że na kroku DANE otworzyła
// menu (jedyne wyjście w tym lejku, bo app-shellowy „wstecz" jest ukryty) i
// dotknęła czegokolwiek: bramka robiła `replace` z powrotem na onboarding,
// komponent montował się od zera i „Kasia Nowak" oraz „Warszawa" znikały bez
// słowa, a licznik wracał na 1/5. Ta sama klasa obejmuje cofnięcie przeglądarką,
// wygaszenie ekranu w skorupie natywnej i przypadkowy deep-link z powiadomienia.
//
// DECISION (nie usuwaj tego komentarza):
// 1. sessionStorage, nie localStorage: szkic niesie imię, miasto i telefon, więc
//    ma zniknąć razem z kartą przeglądarki. Dodatkowo kasuje go wylogowanie
//    (`AuthContext.clearTokens`, ta sama ścieżka co lejek cennika), żeby na
//    wspólnym urządzeniu nie wpadł do formularza następnej osoby.
// 2. Odtworzone pola oznaczamy `shouldDirty`, bo efekty `applyFunnelPrefill` i
//    prefill roli z `?role=` nadpisują WYŁĄCZNIE pola nietknięte. Bez tego
//    wybór planu z odtworzonego szkicu przegrywał z planem z lejka cennika.
// 3. Krok przywracamy PRZYCIĘTY do PREFERENCES. Krok płatności wymaga konta,
//    które powstaje dopiero przy wyjściu z PREFERENCES, a panel mintuje tam
//    sesję Stripe: zimne wejście prosto na CHECKOUT montowałoby panel płatności
//    dla konta, którego może nie być. Uwaga na to, czego to NIE robi: zatrzask
//    `submittedKey` żyje w stanie kompozycji i nie jest odtwarzany, więc jeśli
//    konto już istnieje (stylistka doszła kiedyś do wyboru planu i odbiła się od
//    bramki), „Dalej" na PREFERENCJACH puszcza mutację onboardingu jeszcze raz,
//    zamiast samo przejść krok. Mutacja jest idempotentna (find-or-create po
//    stronie `onboardAsStylist_IO`), więc koszt to jedno zbędne zapytanie, a nie
//    duplikat konta ani zgubione dane. Gdyby kiedyś przeszkadzało: sygnałem jest
//    obecność `stylist_account` w sesji, nie flaga w szkicu.
// 4. Zapis idzie przez subskrypcję `watch(cb)`, a nie przez `watch()` bez
//    argumentu: to drugie przerysowuje CAŁĄ kompozycję przy każdym naciśnięciu
//    klawisza, a kompozycja renderuje krok, wskaźnik i belkę akcji.
// 5. Zgody odtwarzamy razem z resztą pól i jest to świadome. To nie jest
//    wstępne zaznaczenie checkboxa: znacznik pochodzi z JEJ zaznaczenia, w tej
//    samej karcie i tej samej sesji, a szkic ginie razem z kartą i razem z
//    wylogowaniem. Alternatywa (nie odtwarzać) psuła lejek: po powrocie na krok
//    DANE zgody byłyby puste, a `ensureOnboardingConsent` odesłałby ją na krok
//    ROLA dopiero przy „Zakończ", czyli dwa kroki później. Zapis zgody i tak
//    powstaje po stronie serwera dopiero przy wysyłce onboardingu.

import { useEffect, useRef } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { STORAGE_KEYS } from '../../../../application/client-device-storage/storage-keys.config';
import {
  deleteFromClientStorage,
  getFromClientStorage,
  setToClientStorage,
} from '../../../../application/client-device-storage/clientStorage.possibilities.api';
import {
  ONBOARDING_DEFAULTS,
  ONBOARDING_STEP,
  type OnboardingFormValues,
} from '../onboarding.types';

interface OnboardingDraft {
  step: number;
  values: OnboardingFormValues;
}

/** Najdalszy krok, na jaki wolno wrócić zimnym startem (patrz DECISION 3). */
const MAX_RESTORABLE_STEP = ONBOARDING_STEP.PREFERENCES;

/** Kasuje szkic. Wołane po ukończeniu onboardingu i przy wylogowaniu. */
export function clearOnboardingDraft(): void {
  deleteFromClientStorage({ key: STORAGE_KEYS.ONBOARDING_DRAFT });
}

/**
 * Czyta szkic z pamięci sesji i zwęża go do znanego kształtu. Cokolwiek
 * niezgodnego (ręczna edycja pamięci, szkic ze starszej wersji formularza)
 * traktujemy jak brak szkicu: onboarding ma ruszyć, a nie wywalić się na
 * cudzym JSON-ie.
 */
function readOnboardingDraft(): OnboardingDraft | null {
  const raw = getFromClientStorage({ key: STORAGE_KEYS.ONBOARDING_DRAFT });
  if (raw === null || raw === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const values = record.values;
  if (typeof values !== 'object' || values === null) {
    return null;
  }
  return {
    step: typeof record.step === 'number' ? record.step : ONBOARDING_STEP.ROLE,
    values: narrowDraftValues(values as Record<string, unknown>),
  };
}

/* SCALE celowo POZA listą, parytet z `usePricingFunnelState`: plan kontaktowy
 * nie ma produktu w Stripe, więc odtworzony z niego szkic zaprowadziłby panel
 * płatności na `CHECKOUT_PLAN_NOT_FOUND` bez wyjścia (onboarding nie ma
 * przełącznika planu poza chooserem). Organicznie to niemożliwe, bo SCALE nie
 * stoi w `CARD_ORDER`, ale dwa zbiory istniejące z tego samego powodu mają
 * wyglądać tak samo, inaczej następna zmiana poprawi tylko jeden. */
const VALID_PLAN_IDS: ReadonlySet<string> = new Set<string>(
  Object.values(PricingPlanValue).filter(p => p !== PricingPlanValue.SCALE)
);

/**
 * Zwęża nieufny obiekt do kształtu formularza, pole po polu. Każde pole spoza
 * kształtu (ręczna edycja pamięci, szkic ze starszej wersji formularza) wraca
 * na wartość domyślną, zamiast wjechać do stanu Reacta jako `unknown`.
 */
function narrowDraftValues(raw: Record<string, unknown>): OnboardingFormValues {
  const text = (value: unknown, fallback: string): string =>
    typeof value === 'string' ? value : fallback;
  const flag = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;

  const role: OnboardingFormValues['role'] =
    raw.role === 'stylist' || raw.role === 'client' || raw.role === ''
      ? raw.role
      : ONBOARDING_DEFAULTS.role;
  const plan: PricingPlan | null =
    typeof raw.selected_plan_id === 'string' &&
    VALID_PLAN_IDS.has(raw.selected_plan_id)
      ? (raw.selected_plan_id as PricingPlan)
      : raw.selected_plan_id === null
        ? null
        : ONBOARDING_DEFAULTS.selected_plan_id;
  const billing: BillingPeriod =
    raw.billing_period === 'month' || raw.billing_period === 'year'
      ? raw.billing_period
      : ONBOARDING_DEFAULTS.billing_period;

  return {
    role,
    display_name: text(raw.display_name, ONBOARDING_DEFAULTS.display_name),
    address_city: text(raw.address_city, ONBOARDING_DEFAULTS.address_city),
    phone: text(raw.phone, ONBOARDING_DEFAULTS.phone),
    instagram_handle: text(
      raw.instagram_handle,
      ONBOARDING_DEFAULTS.instagram_handle
    ),
    terms_accepted: flag(
      raw.terms_accepted,
      ONBOARDING_DEFAULTS.terms_accepted
    ),
    marketing_consent: flag(
      raw.marketing_consent,
      ONBOARDING_DEFAULTS.marketing_consent
    ),
    notifications_on: flag(
      raw.notifications_on,
      ONBOARDING_DEFAULTS.notifications_on
    ),
    selected_plan_id: plan,
    billing_period: billing,
  };
}

interface UseOnboardingDraftArgs {
  methods: UseFormReturn<OnboardingFormValues>;
  currentStep: number;
  /** Ustawia krok po odtworzeniu szkicu (kompozycja jest właścicielem stanu). */
  onRestoreStep: (step: number) => void;
  /** Widok terminalny: przestajemy zapisywać, szkic jest już niepotrzebny. */
  showSuccess: boolean;
}

/**
 * Odtwarza szkic przy montowaniu i zapisuje go przy każdej zmianie pola oraz
 * kroku. Odtworzenie jest jednorazowe (zatrzask `restoredRef`), żeby późniejszy
 * zapis nie zawracał użytkowniczki na krok, z którego właśnie wyszła.
 */
export function useOnboardingDraft({
  methods,
  currentStep,
  onRestoreStep,
  showSuccess,
}: UseOnboardingDraftArgs): void {
  const restoredRef = useRef(false);
  const stepRef = useRef(currentStep);

  // Odtworzenie — raz, przy montowaniu.
  useEffect(() => {
    if (restoredRef.current) {
      return;
    }
    restoredRef.current = true;
    const draft = readOnboardingDraft();
    if (draft === null) {
      return;
    }
    for (const key of Object.keys(
      draft.values
    ) as (keyof OnboardingFormValues)[]) {
      // `shouldDirty` TYLKO tam, gdzie szkic odbiega od wartości domyślnej.
      // Bezwarunkowe brudzenie wszystkich dziewięciu pól odwracało kanon
      // dirty-wins przeciwko użytkowniczce: porzucony lejek zapisywał
      // NIETKNIĘTY zimny start (plan PRO, cykl miesięczny), a przy powrocie
      // przez cennik ten zapis brudził oba pola i wygrywał ze świeżym,
      // świadomym wyborem z `/pricing` (np. Studio rocznie). Wybór równy
      // domyślnemu zostaje czysty, więc nowszy sygnał z cennika ma pierwszeństwo
      // i to jest właściwa kolejność: on jest późniejszy.
      const value = draft.values[key];
      methods.setValue(key, value, {
        shouldDirty: value !== ONBOARDING_DEFAULTS[key],
      });
    }
    const step = Math.min(
      Math.max(draft.step, ONBOARDING_STEP.WELCOME),
      MAX_RESTORABLE_STEP
    );
    if (step !== ONBOARDING_STEP.WELCOME) {
      onRestoreStep(step);
    }
  }, [methods, onRestoreStep]);

  // Zapis przy zmianie pola (subskrypcja, bez przerysowania kompozycji).
  useEffect(() => {
    if (showSuccess) {
      return;
    }
    const subscription = methods.watch(values => {
      setToClientStorage({
        key: STORAGE_KEYS.ONBOARDING_DRAFT,
        value: JSON.stringify({ step: stepRef.current, values }),
        sessionOnly: true,
      });
    });
    return () => subscription.unsubscribe();
  }, [methods, showSuccess]);

  // Zapis przy zmianie kroku (sam krok nie przechodzi przez `watch`).
  useEffect(() => {
    stepRef.current = currentStep;
    if (showSuccess) {
      return;
    }
    setToClientStorage({
      key: STORAGE_KEYS.ONBOARDING_DRAFT,
      value: JSON.stringify({ step: currentStep, values: methods.getValues() }),
      sessionOnly: true,
    });
  }, [currentStep, methods, showSuccess]);
}
