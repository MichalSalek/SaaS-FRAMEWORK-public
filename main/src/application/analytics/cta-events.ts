// application/analytics/cta-events.ts
// Most między PostHogiem a GTM dla zdarzeń lejka marketingowego.
//
// Stan przed tym plikiem: strony statyczne miały CTA wszędzie (hero, pasek
// dolny, band końcowy, podgląd cennika), a zdarzeń — dwa, oba na /pricing i oba
// wyłącznie w PostHogu. GA4 widziało z całego serwisu `page_view` i `scroll`.
// Kontener GTM nie dostawał NICZEGO, bo front nigdy nie pisał do `dataLayer`.
//
// Dlaczego oba ujścia naraz: PostHog to mózg produktu (funnele, replay, cohorty),
// ale konwersje do Google Ads i Search Console idą przez GA4, a do GA4 wchodzi
// się przez GTM. Jedno wywołanie w komponencie, dwa ujścia — inaczej za tydzień
// połowa CTA jest w jednym narzędziu, a połowa w drugim.
//
// Zgoda: PostHog respektuje opt-out wewnątrz singletona (PostHogProvider), a
// `dataLayer` przechodzi przez Consent Mode ustawiany w AnalyticsScripts — ten
// plik niczego w tym nie zmienia.
//
// Rejestr nazw i properties → docs/DOMAIN/product/ANALYTICS_TRACKING_PLAN.md

import posthog from 'posthog-js';
import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';

/**
 * Miejsce CTA na stronie. Unia literałów, nie `string`: literówka w miejscu
 * („hero-stylists" zamiast „stylists-hero") nie jest błędem widocznym w UI, tylko
 * cichym rozjazdem w raporcie, który wychodzi na jaw miesiąc później.
 */
export type CtaLocation =
  // strona główna
  | 'home-hero'
  | 'home-mid'
  | 'home-showcase'
  | 'home-bottom'
  | 'home-sticky'
  // dla stylistek
  | 'stylists-hero'
  | 'stylists-final'
  | 'stylists-sticky'
  | 'stylists-pricing-preview'
  | 'stylists-pricing-link'
  | 'stylists-clients-link'
  | 'stylists-compare-link'
  // dla salonów
  | 'studios-hero'
  | 'studios-final'
  | 'studios-sticky'
  | 'studios-pricing-preview'
  | 'studios-pricing-link'
  | 'studios-stylists-link'
  // dla klientek
  | 'clients-hero'
  | 'clients-mid'
  | 'clients-sticky'
  // cennik
  | 'pricing-tier'
  | 'pricing-final'
  | 'pricing-sticky'
  | 'pricing-compare-link'
  | 'pricing-scale'
  // porównanie
  | 'compare-hero'
  | 'compare-final'
  | 'compare-sticky'
  | 'compare-pricing-link'
  | 'compare-stylists-link'
  // o nas
  | 'about-login'
  | 'about-client'
  | 'about-sticky'
  | 'about-pricing-link'
  // aplikacja
  | 'get-app-hero'
  | 'get-app-sticky'
  | 'get-app-stylists-link'
  // pomoc
  | 'help-center-contact'
  | 'help-center-sticky'
  | 'help-center-after'
  // blog
  | 'blog-after-post'
  | 'blog-mid-post'
  | 'blog-index-footer'
  // kontakt
  | 'contact-form'
  | 'contact-final'
  | 'contact-sticky';

export type PageKind =
  | 'home'
  | 'stylists'
  | 'studios'
  | 'clients'
  | 'pricing'
  | 'compare'
  | 'about'
  | 'blog'
  | 'help'
  | 'get-app'
  | 'contact'
  | 'other';

const PAGE_KIND_BY_PATH: ReadonlyArray<readonly [string, PageKind]> = [
  ['/for-stylists', 'stylists'],
  ['/for-studios', 'studios'],
  ['/for-clients', 'clients'],
  ['/pricing', 'pricing'],
  ['/compare', 'compare'],
  ['/about', 'about'],
  ['/blog', 'blog'],
  ['/help-center', 'help'],
  ['/help', 'help'],
  ['/get-app', 'get-app'],
  ['/contact', 'contact'],
];

/**
 * Rodzaj strony liczony ze ścieżki, nie podawany przez komponent. GA4 zna
 * `page_path`, ale pytanie „czy treść sprzedaje" powinno być jednym wymiarem
 * w raporcie, a nie regexem po adresach.
 */
/**
 * Zdejmuje prefiks języka ze ścieżki. Bez tego `/en/pricing` i `/de/blog/...`
 * wpadały do kategorii „other", więc cały ruch nie-polski znikał z podziału na
 * rodzaje stron — a to jedyny wymiar, po którym widać, czy treść sprzedaje.
 */
function stripLocalePrefix(pathname: string): string {
  for (const locale of I18N_CONFIG.locales) {
    if (pathname === `/${locale}`) {
      return '/';
    }
    if (pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1);
    }
  }
  return pathname;
}

export function resolvePageKind(pathname: string): PageKind {
  const path = stripLocalePrefix(pathname);
  if (path === '/') {
    return 'home';
  }
  const hit = PAGE_KIND_BY_PATH.find(([prefix]) => path.startsWith(prefix));
  return hit ? hit[1] : 'other';
}

interface DataLayerWindow extends Window {
  dataLayer?: Record<string, unknown>[];
}

type EventProps = Record<string, string | number | boolean | undefined>;

/**
 * Jedno zdarzenie, dwa ujścia. Awaria jednego nie może zabrać drugiego ani —
 * tym bardziej — przerwać nawigacji: to są CTA, więc wyjątek z analityki
 * oznaczałby przycisk, który nie działa.
 */
function emit(name: string, props: EventProps): void {
  if (typeof window === 'undefined') {
    return;
  }

  const enriched: EventProps = {
    ...props,
    page_kind: resolvePageKind(window.location.pathname),
  };

  try {
    posthog.capture(name, enriched);
  } catch {
    // PostHog niedostępny (adblock, brak klucza) — GTM ma dostać swoje mimo to.
  }

  try {
    const w = window as DataLayerWindow;
    w.dataLayer = w.dataLayer ?? [];
    w.dataLayer.push({ event: name, ...enriched });
  } catch {
    // dataLayer zamrożony przez rozszerzenie przeglądarki — nie nasz problem do rozwiązania tutaj.
  }
}

// DECISION (nie usuwaj tego komentarza) — Clarity tagging lives HERE, not in GTM
// (testy-api s34): the two GTM Custom HTML tags that did this injected INLINE
// scripts, which the production CSP (no 'unsafe-inline', no nonce on SSG) blocks,
// so on prod they never ran. One uses GTM variables, so a CSP hash cannot pin it.
// Calls go through Clarity's official queue stub: nothing leaves the browser until
// the Clarity tag itself loads (consent is enforced by GTM, which loads it).
type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[][] };

function clarity(...args: unknown[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  const w = window as unknown as { clarity?: ClarityFn };
  if (!w.clarity) {
    const stub: ClarityFn = (...queued: unknown[]) => {
      (stub.q ??= []).push(queued);
    };
    w.clarity = stub;
  }
  try {
    w.clarity(...args);
  } catch {
    // Clarity is best-effort session tagging; it must never break a click.
  }
}

/** Klik w dowolne CTA na stronie statycznej. Intencja, nie konwersja. */
export function trackCtaClick(
  location: CtaLocation,
  plan?: PricingPlan | null
): void {
  emit('cta_click', { location, ...(plan != null ? { plan } : {}) });
  clarity('set', 'cta_clicked', location);
  clarity('event', 'cta_click');
}

/**
 * Wejście w rejestrację. ŚWIADOMIE nie mapowane na `generate_lead` w GA4:
 * kliknięcie „załóż konto" to nie jest pozyskany lead, a zawyżona konwersja
 * jest gorsza niż jej brak, bo raport wygląda wtedy zdrowo.
 */
export function trackSignupStarted(
  location: CtaLocation,
  plan?: PricingPlan | null
): void {
  emit('signup_started', { location, ...(plan != null ? { plan } : {}) });
  clarity('set', 'signup_started', 'true');
  // Raise recording priority for sessions that reach registration.
  clarity('upgrade', 'signup_started');
}

/** Wybór planu w cenniku. W GA4 ląduje jako `select_item`. */
export function trackPricingPlanClicked(
  plan: PricingPlan,
  billingPeriod: BillingPeriod,
  location: CtaLocation = 'pricing-tier'
): void {
  emit('pricing_plan_clicked', {
    plan,
    billing_period: billingPeriod,
    location,
  });
}

/**
 * Klik w link wewnętrzny w treści. Krawędź grafu przejść: mówi CZYM ktoś poszedł
 * dalej, czego odsłona sama z siebie nie powie. Zobacz UI/hooks/useInternalLinkTracking.
 */
export function trackInternalLinkClick(target: string): void {
  emit('internal_link_click', { target });
}

/** Progi przewinięcia: 25 / 50 / 75 / 100 procent. */
export type ScrollDepth = 25 | 50 | 75 | 100;

/** Zobacz UI/hooks/useScrollDepth — tam mieszka uzasadnienie progów. */
export function trackScrollDepth(depth: ScrollDepth): void {
  emit('scroll_depth', { depth });
}

/**
 * Zapis na newsletter. Też lead, więc ta sama nazwa w GA4 co formularz
 * kontaktowy; rozróżnia je `cta_location` pochodzące z `consentSource`.
 */
export function trackNewsletterSignup(source: string): void {
  emit('contact_form_submitted', { location: source });
}

/** Wysłany formularz kontaktowy. To JEST lead — w GA4 `generate_lead`. */
export function trackContactFormSubmitted(): void {
  emit('contact_form_submitted', { location: 'contact-form' });
}

/**
 * Konto z rolą utworzone. Jedyna prawdziwa konwersja rejestracji, w GA4 `sign_up`.
 * `role` jest tu obowiązkowe, bo stylistka i klientka to dwa różne wyniki
 * biznesowe — bez tego wymiaru „rejestracje" są liczbą, z której nic nie wynika.
 */
export function trackSignupCompleted(role: 'client' | 'stylist'): void {
  emit('signup_completed', { role });
}

/**
 * Opakowanie handlera nawigacji w pomiar. Zdarzenie idzie PRZED nawigacją, ale
 * wysyłka jest nieblokująca (PostHog i GTM kolejkują), więc przejście nie czeka
 * na sieć. Argumenty są ignorowane celowo: opakowanie trafia wprost do
 * `onClick`, więc React poda tu obiekt zdarzenia, którego nie chcemy w danych.
 */
export function withCtaTracking(
  location: CtaLocation,
  handler: () => void
): () => void {
  return () => {
    trackCtaClick(location);
    handler();
  };
}

/** Jak wyżej, ale dla CTA prowadzącego do rejestracji. */
export function withSignupTracking(
  location: CtaLocation,
  handler: () => void,
  plan?: PricingPlan | null
): () => void {
  return () => {
    trackSignupStarted(location, plan);
    handler();
  };
}
