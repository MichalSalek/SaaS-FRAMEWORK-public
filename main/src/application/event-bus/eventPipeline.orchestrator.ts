import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { isEventDisallowedForUI } from '@kernel/domain/commands-and-queries/cqrs.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { EVENT_PIPELINE_CONFIG } from '@kernel/domain/events/event-pipeline.config';
import {
  CRITICAL_REDIRECTIONS_ON_EVENTS,
  ROUTES_FRONT,
} from '@kernel/domain/routing/routing.config';
import { PERMISSIONS_POLICY } from '@kernel/policies/permissions.policy';
import type { SafeCurrentUser } from '@kernel/models/session/session.dto';
import type { SnackbarWrapper } from '../app-snackbar/appSnackbar.types';
import { pushNewSnackbar } from '../app-snackbar/appSnackbar.possibilities.api';
import { __debuggerGate } from '../error-debugger/debugger.utils.api';
import { reportIssueFrontend } from '../error-debugger/errorHandler.possibilities.api';
import { resetUserSlice } from '../stores/user-cache';
import { redirectToAction } from '../routing/redirections';
import type { ROUTES_FRONT_PATH } from '@kernel/domain/routing/routing.types';
import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
import { queryClient } from '../http/queryClient.config';
import { queryKeys } from '../http/queryKeys.factory';

// === PUBLIC TYPE (replaces EventBusSideEffectInterceptor) ===

/**
 * Pipeline payload — currently a single optional field used by the snackbar
 * stage to override the inferred toast color. Tight type instead of
 * `Record<string, unknown>` so the only documented payload field is
 * compiler-enforced; downstream stages can add new keys here as needed.
 */
type EventPipelinePayload = {
  snackbarColor?: SnackbarWrapper['color'];
};

export type EventPipelineInput = {
  payload?: EventPipelinePayload;
  event: EVENT_INFO_TYPE;
};

// === INTERNAL CONTEXT ===

type PipelineContext = {
  readonly event: EVENT_INFO_TYPE;
  readonly snackbarColor: SnackbarWrapper['color'];
  readonly sequenceId: number;
  readonly currentUser: SafeCurrentUser | undefined;
  readonly currentPathname: ROUTES_FRONT_PATH;
  snackbarDispatched: boolean;
  stateEffect: 'FULL_RESET' | 'GOBACK_RESET' | 'NONE';
  redirectTarget: ROUTES_FRONT_PATH | null;
};

const VALID_SNACKBAR_COLORS: SnackbarWrapper['color'][] = [
  'success',
  'info',
  'warning',
  'error',
];

// === O(1) LOOKUP SETS (created once at module load from SSOT arrays) ===

const STATE_FULL_RESET_EVENTS = new Set<EVENT_INFO_TYPE>(
  EVENT_PIPELINE_CONFIG.STATE_FULL_RESET
);
const STATE_GOBACK_RESET_EVENTS = new Set<EVENT_INFO_TYPE>(
  EVENT_PIPELINE_CONFIG.STATE_GOBACK_RESET
);
const REDIRECT_UNCONDITIONAL_EVENTS = new Set<EVENT_INFO_TYPE>(
  EVENT_PIPELINE_CONFIG.REDIRECT_UNCONDITIONAL
);

// === EVENT → REDIRECT KEY MAPPING (O(1) Record lookup replaces 5-way switch) ===

const EVENT_TO_CRITICAL_REDIRECT_KEY: Partial<
  Record<EVENT_INFO_TYPE, keyof typeof CRITICAL_REDIRECTIONS_ON_EVENTS>
> = {
  [APP_EVENTS.INFO.USER.ALREADY_LOGGED]: 'ALREADY_LOGGED',
  [APP_EVENTS.INFO.USER.LOGIN_FIRST]: 'LOGIN_FIRST',
  [APP_EVENTS.INFO.USER.UNAUTHORIZED]: 'UNAUTHORIZED',
  [APP_EVENTS.INFO.SESSION.SESSION_EXPIRED]: 'SESSION_EXPIRED',
  [APP_EVENTS.INFO.USER.PLATFORM_GATE]: 'PLATFORM_GATE',
  // Graceful eviction: backend 403 USER_DISABLED (inactive account state) →
  // critical redirect to USER_LOG + STATE_FULL_RESET (UNCONDITIONAL). Rationale +
  // full pipeline trace: CRITICAL_REDIRECTIONS_ON_EVENTS (routing.config).
  [APP_EVENTS.INFO.USER.USER_DISABLED]: 'USER_DISABLED',
};

// === PIPELINE ENTRY POINT ===

let pipelineSequenceCounter = 0;

/**
 * Event Pipeline Orchestrator — central entry point for ALL application events.
 *
 * PIPELINE ORDER (all stages sequential, deterministic):
 *   1. SNACKBAR — sync push to Zustand snackbar queue (reads eventsDisallowedForUI from SSOT)
 *   2. STATE    — sync TanStack Query cache mutations (reads EVENT_PIPELINE_CONFIG from SSOT)
 *   3. REDIRECT — async Router.replace (50-200ms only for redirect events, SSOT-driven)
 *
 * Each stage is wrapped in try/catch — one stage failure does NOT block subsequent stages.
 * Debug logging is automatic when the dev-mode store reports debugOn = true.
 */
export const eventPipelineOrchestrator = async ({
  event,
  payload = {},
}: EventPipelineInput): Promise<void> => {
  if (!event) {
    return;
  }

  // Runtime guard kept even with strong typing: callers passing the payload
  // through `unknown` boundaries (e.g. interceptors deserialized from network
  // envelopes) can still send arbitrary strings.
  const rawColor = payload.snackbarColor;
  const snackbarColor: SnackbarWrapper['color'] =
    rawColor !== undefined && VALID_SNACKBAR_COLORS.includes(rawColor)
      ? rawColor
      : 'success';

  const ctx: PipelineContext = {
    event,
    snackbarColor,
    sequenceId: ++pipelineSequenceCounter,
    currentUser: queryClient.getQueryData<SafeCurrentUser | undefined>(
      queryKeys.account.current
    ),
    // DECISION (nie usuwaj tego komentarza):
    // `as ROUTES_FRONT_PATH` to swiadomy cast. W runtime pathname moze byc sciezka
    // dynamiczna (np. /app/gallery/stylist/abc123), ktora NIE jest czlonem
    // ROUTES_FRONT. To bezpieczne: pipeline uzywa currentPathname wylacznie do
    // dopasowania redirectu (=== / startsWith) oraz buildLoginFromQuery(:string);
    // nieznana sciezka po prostu nie matchuje i redirect sie nie odpala. Nie
    // zawężamy pola do `string`, bo intencja typu to ZNANE trasy — dynamiczne
    // sciezki tolerujemy jako no-match, nie jako blad.
    currentPathname: (typeof window !== 'undefined'
      ? window.location.pathname
      : '') as ROUTES_FRONT_PATH,
    snackbarDispatched: false,
    stateEffect: 'NONE',
    redirectTarget: null,
  };

  logPipelineStage(ctx, 'START', 'pipeline begin');

  // Stage 1: SNACKBAR (sync)
  try {
    stageSnackbarNotification(ctx);
  } catch (stageError) {
    logPipelineStage(ctx, 'SNACKBAR_ERROR', String(stageError));
  }

  // Stage 2: STATE CHANGES (sync TanStack Query cache reset)
  try {
    stageApplicationStateReset(ctx);
  } catch (stageError) {
    logPipelineStage(ctx, 'STATE_ERROR', String(stageError));
  }

  // Stage 3: REDIRECTIONS (async Router.replace)
  try {
    await stageCriticalRedirection(ctx);
  } catch (stageError) {
    logPipelineStage(ctx, 'REDIRECT_ERROR', String(stageError));
  }

  logPipelineStage(ctx, 'END', 'pipeline complete');
};

// === RECOVERY-AWARE EVICTION PREDICATE ===

// DECISION (nie usuwaj tego komentarza):
// Predykat współdzielony przez DWA etapy pipeline: Stage 1 (wyciszenie mylącego
// toastu USER_DISABLED „Użytkownik został wyłączony") i Stage 3 (redirect na
// /recover zamiast login-eviction). Soft-deleted user (deleted_at set =
// RECOVERABLE lub EXPIRED) z ważnym tokenem, którego tło-query 403-uje
// USER_DISABLED, NIE jest „wyłączony" z jego perspektywy — pipeline kieruje go na
// /recover (self-service), który sam tłumaczy stan (countdown+Przywróć / GDPR).
// Realny ban/self-disable (deleted_at===null) → false → login-eviction + toast
// (bez zmian). currentUser===undefined (nie w cache) → false → bezpieczny default
// eviction (= zachowanie sprzed fixu). Snapshot ctx.currentUser jest sprzed
// STATE_FULL_RESET (przechwycony przy tworzeniu ctx) → stabilny w obu etapach.
// Pełne uzasadnienie redirectu + granica bezpieczeństwa: DECISION w Stage 3.
const isRecoveryEviction = (ctx: PipelineContext): boolean =>
  ctx.event === APP_EVENTS.INFO.USER.USER_DISABLED &&
  ctx.currentUser?.deleted_at != null;

// === STAGE 1: SNACKBAR NOTIFICATION ===

const stageSnackbarNotification = (ctx: PipelineContext): void => {
  // DECISION (nie usuwaj tego komentarza):
  // Recovery-aware suppression — recoverable/expired user jest przekierowany na
  // /recover (Stage 3), który self-tłumaczy stan → toast „Użytkownik został
  // wyłączony" byłby redundantny I mylący (user odzyskuje konto, nie jest
  // wyłączony). Symetryczne z recovery-aware redirectem w Stage 3 (ten sam
  // predykat). Realny ban/self-disable (deleted_at===null) nadal toastuje.
  if (isRecoveryEviction(ctx)) {
    ctx.snackbarDispatched = false;
    logPipelineStage(ctx, 'SNACKBAR', 'suppressed (recovery-aware eviction)');
    return;
  }
  pushNewSnackbar(ctx.event, ctx.snackbarColor);
  ctx.snackbarDispatched = !isEventDisallowedForUI(ctx.event);
  logPipelineStage(
    ctx,
    'SNACKBAR',
    ctx.snackbarDispatched ? 'dispatched' : 'suppressed by SSOT'
  );
};

// === STAGE 2: APPLICATION STATE RESET ===

const stageApplicationStateReset = (ctx: PipelineContext): void => {
  if (STATE_FULL_RESET_EVENTS.has(ctx.event)) {
    resetUserSlice();
    ctx.stateEffect = 'FULL_RESET';
    logPipelineStage(ctx, 'STATE', 'FULL_RESET: resetUserSlice (TQ cache)');
    return;
  }

  // GOBACK_RESET branch: legacy Redux goBack history was retired with the
  // new router stack — no state to reset, but we still record the event
  // so observability stays consistent with the SSOT pipeline contract.
  if (STATE_GOBACK_RESET_EVENTS.has(ctx.event)) {
    ctx.stateEffect = 'GOBACK_RESET';
    logPipelineStage(ctx, 'STATE', 'GOBACK_RESET: noop (history retired)');
    return;
  }
};

// === LOCALE STRIP HELPER ===

// Strips the leading /<locale> segment from a pathname so loop-guard comparisons
// work locale-agnostically. Example: /pl/user/login → /user/login.
// Only removes a known locale segment (pl|en|de) — does not affect bare paths
// or paths that start with non-locale segments.
const _localeSegmentRe = new RegExp(
  `^/(${I18N_CONFIG.locales.join('|')})(?=/|$)`
);
const stripLocalePrefix = (pathname: string): string =>
  pathname.replace(_localeSegmentRe, '') || '/';

// === STAGE 3: CRITICAL REDIRECTION ===

const doesUserHaveRoutePermission = (
  currentUser: SafeCurrentUser | undefined,
  currentPath: ROUTES_FRONT_PATH
): boolean =>
  PERMISSIONS_POLICY.utils.GET_PERMISSION_APPROVAL_FOR_ROUTE({
    ...(currentUser?.role_id !== undefined && { roleId: currentUser.role_id }),
    requestedRoutePath: currentPath,
  });

/**
 * DD2-D7: Preserve intended URL on LOGIN_FIRST. When an authenticated route
 * is requested without a session, capture the requested path in a `from`
 * query param so the login page can return the user to where they meant
 * to go. Only applied to LOGIN_FIRST — other critical redirects (UNAUTHORIZED,
 * SESSION_EXPIRED, PLATFORM_GATE, ALREADY_LOGGED) have different semantics
 * and should NOT round-trip the original path.
 *
 * Safety: only same-origin app paths (must start with "/" but NOT "//") are
 * captured to prevent open-redirect via crafted state.
 */
const buildLoginFromQuery = (
  targetRoute: string,
  currentPathname: string
): string | undefined => {
  const isSafePath =
    typeof currentPathname === 'string' &&
    currentPathname.length > 0 &&
    currentPathname.startsWith('/') &&
    !currentPathname.startsWith('//') &&
    currentPathname !== targetRoute;
  if (!isSafePath) {
    return undefined;
  }
  return `from=${encodeURIComponent(currentPathname)}`;
};

const stageCriticalRedirection = async (
  ctx: PipelineContext
): Promise<void> => {
  const redirectKey = EVENT_TO_CRITICAL_REDIRECT_KEY[ctx.event];
  if (!redirectKey) {
    return;
  }

  // DECISION (nie usuwaj tego komentarza):
  // Recovery-aware eviction (ADRR §13.1) — PIPELINE (nie kazdy call-site) posiada granice.
  // USER_DISABLED ewiktuje nieaktywne konto z waznym tokenem (backend 403 → event pipeline).
  // Ale konto SOFT-DELETED (deleted_at set = RECOVERABLE/EXPIRED) ma self-service ekran
  // recovery — kierujemy je TAM, nie na login-eviction. To zamyka klase buga STRUKTURALNIE:
  // dowolny PRZYSZLY ungated authed query montowany w app-shellu / na /recover, ktory 403-uje
  // USER_DISABLED dla recoverable usera, wyladuje go na /recover (jego wlasciwy cel, zgodny z
  // useRecoveryGuard), NIGDY nie wyrzuci z ekranu recovery zanim klikne „Przywroc konto".
  // Przedtem pipeline WALCZYL z recovery-guardem (guard→/recover vs pipeline→/user/login,
  // unconditional wygrywal); teraz sie ZGADZAJA. Admin-ban / self-disable (deleted_at===null →
  // brak self-recovery) dalej ewiktuja na login. To FRONTEND-UX eviction, nie security boundary
  // (backend account-state-guard trzyma granice), wiec zmiana CELU redirectu nie oslabia
  // bezpieczenstwa: /recover dopuszcza tylko reactivate/gdpr (allowlist §13.1). currentUser===
  // undefined (nie w cache) → deleted_at?.!=null falszywe → login-eviction (bezpieczny default,
  // = zachowanie sprzed fixu). ctx.currentUser to snapshot sprzed STATE_FULL_RESET (stage 2).
  const targetRoute: ROUTES_FRONT_PATH = isRecoveryEviction(ctx)
    ? ROUTES_FRONT.USER_RECOVER
    : CRITICAL_REDIRECTIONS_ON_EVENTS[redirectKey];

  // Guard: prevent infinite redirect loop.
  // Strip leading /<locale> prefix before comparing so the guard fires correctly
  // for i18n-prefixed paths (e.g. /pl/user/login vs bare /user/login).
  if (stripLocalePrefix(ctx.currentPathname) === targetRoute) {
    return;
  }

  // Conditional redirects: skip if user has permission for current route
  const isUnconditionalRedirect = REDIRECT_UNCONDITIONAL_EVENTS.has(ctx.event);
  if (
    !isUnconditionalRedirect &&
    doesUserHaveRoutePermission(ctx.currentUser, ctx.currentPathname)
  ) {
    return;
  }

  // DD2-D7: For LOGIN_FIRST specifically, append `?from=<currentPath>` so
  // LoginPage can route the user back after a successful login.
  const loginFromQuery =
    redirectKey === 'LOGIN_FIRST'
      ? buildLoginFromQuery(targetRoute, ctx.currentPathname)
      : undefined;

  ctx.redirectTarget = targetRoute;
  logPipelineStage(
    ctx,
    'REDIRECT',
    `redirecting to ${targetRoute}${loginFromQuery ? '?' + loginFromQuery : ''}`
  );
  await redirectToAction({
    routePath: targetRoute,
    ...(loginFromQuery !== undefined && { query: loginFromQuery }),
  });
};

// === DEBUG LOGGING ===

const logPipelineStage = (
  ctx: PipelineContext,
  stage: string,
  detail: string
): void => {
  __debuggerGate(() =>
    reportIssueFrontend({
      namespace: `EventPipeline[#${ctx.sequenceId}] [${stage}]`,
      message: `${ctx.event} — ${detail}`,
      payload: {
        snackbarColor: ctx.snackbarColor,
        snackbarDispatched: ctx.snackbarDispatched,
        stateEffect: ctx.stateEffect,
        redirectTarget: ctx.redirectTarget,
      },
      mode: 'info',
    })
  );
};
