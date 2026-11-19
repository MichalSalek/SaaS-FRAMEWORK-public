/** A presentation-only history entry. It never describes a purchase intent. */
import { normalizeNavPathname } from '../policies/navigation-transition.policy';

export const PLAN_DECISION_QUERY = 'planDecision';

/** A pop may update the address before the Pages Router context has settled. */
export function isPlanDecisionRouterSettled(
  asPath: string,
  livePath: string
): boolean {
  const routerUrl = new URL(asPath, 'http://plan-decision.invalid');
  const liveUrl = new URL(livePath, 'http://plan-decision.invalid');
  routerUrl.searchParams.sort();
  liveUrl.searchParams.sort();
  return (
    normalizeNavPathname(routerUrl.pathname) ===
      normalizeNavPathname(liveUrl.pathname) &&
    routerUrl.searchParams.toString() === liveUrl.searchParams.toString()
  );
}

interface DecisionOwner {
  isLocked: () => boolean;
  onHistoryClose: () => void;
  onHistoryCloseBlocked?: () => void;
  snapshot: { state: unknown; url: string };
}

let owner: DecisionOwner | null = null;
const pendingPushes = new Set<symbol>();
const pendingReturns = new Set<symbol>();

export function beginPlanDecisionPush(): symbol {
  const token = Symbol('plan-decision-push');
  pendingPushes.add(token);
  return token;
}

export function finishPlanDecisionPush(token: symbol): void {
  pendingPushes.delete(token);
  pendingReturns.delete(token);
}

export function reversePlanDecisionPush(token: symbol): void {
  pendingReturns.add(token);
}

export function hasPendingPlanDecisionPush(): boolean {
  return pendingPushes.size > 0;
}

export function planDecisionUrl(asPath: string, open: boolean): string {
  const url = new URL(asPath, 'http://plan-decision.invalid');
  if (open) {
    url.searchParams.set(PLAN_DECISION_QUERY, '1');
  } else {
    url.searchParams.delete(PLAN_DECISION_QUERY);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function hasPlanDecision(asPath: string): boolean {
  return (
    new URL(asPath, 'http://plan-decision.invalid').searchParams.get(
      PLAN_DECISION_QUERY
    ) === '1'
  );
}

export function hasPlanDecisionOwner(): boolean {
  return owner !== null;
}

export function registerPlanDecisionOwner(input: {
  isLocked: () => boolean;
  onHistoryClose: () => void;
  onHistoryCloseBlocked?: () => void;
}): { release: () => void; snapshot: () => void } {
  const entry: DecisionOwner = {
    ...input,
    snapshot: { state: window.history.state, url: window.location.href },
  };
  owner = entry;
  return {
    release: () => {
      if (owner === entry) {
        owner = null;
      }
    },
    snapshot: () => {
      if (owner === entry) {
        entry.snapshot = {
          state: window.history.state,
          url: window.location.href,
        };
      }
    },
  };
}

/** Called by the ONE Pages Router beforePopState owner, before its route guard. */
export function interceptPlanDecisionPopState(targetAs?: string): boolean {
  if (pendingReturns.size > 0) {
    pendingReturns.forEach(finishPlanDecisionPush);
    // This is the rollback of an abandoned push, not a second user dismissal.
    return false;
  }
  const active = owner;
  if (active === null) {
    return false;
  }
  const current = new URL(active.snapshot.url);
  const target = targetAs === undefined ? null : new URL(targetAs, current);
  if (target?.pathname === current.pathname && hasPlanDecision(target.href)) {
    return false;
  }
  if (active.isLocked()) {
    window.history.pushState(active.snapshot.state, '', active.snapshot.url);
    active.onHistoryCloseBlocked?.();
    return true;
  }
  // Release before the callback so repeated events cannot close the next view.
  owner = null;
  active.onHistoryClose();
  return false;
}
