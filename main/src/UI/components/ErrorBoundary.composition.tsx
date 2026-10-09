// main/src/UI/components/ErrorBoundary.tsx
// React Error Boundary — catches render errors in the component tree.
// Must be a class component (React requires getDerivedStateFromError + componentDidCatch).

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { reportIssueFrontend } from '../../application/error-debugger/errorHandler.possibilities.api';
import { isPosthogErrorTrackingEnabled } from '../../application/analytics/analytics.config';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Required translated heading. Pass via useTranslations from parent. */
  fallbackTitle: string;
  /** Required translated "Try again" button label. */
  fallbackAction: string;
  /**
   * Optional translated "Go to home" button label. When provided, a secondary
   * button is rendered that performs a hard navigation to `/`. This is the
   * escape hatch when re-mounting alone cannot recover (e.g. corrupted state
   * upstream, stale query cache).
   */
  fallbackHomeAction?: string;
  /** Optional fully-custom fallback node (overrides default UI). */
  fallback?: ReactNode;
  /**
   * Optional callback fired after the boundary resets to clear underlying
   * state (e.g. router.push, queryClient.resetQueries). Without it, "Try again"
   * only clears the boundary state — the underlying cause may still re-throw.
   */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundaryComposition extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Forward render errors to backend EventLog via reportIssueFrontend.
    reportIssueFrontend({
      namespace: 'ErrorBoundary',
      message: error.message || 'Unhandled React render error',
      mode: 'error',
      payload: {
        name: error.name,
        stack: error.stack ?? null,
        componentStack: errorInfo.componentStack ?? null,
      },
    });

    // PostHog Error Tracking (dochodzi OBOK EventLog). Błędy renderu React są łapane
    // przez boundary i NIE re-throwowane do window, więc capture_unhandled_errors ich
    // NIE zobaczy — boundary musi je wysłać ręcznie. Guard PRODUCTION-only (spójnie z
    // capture_exceptions w PostHogProvider): dev/staging => dead-code branch, posthog-js
    // nie dubluje się w bundlu (i tak już jest z PostHogProvider). try/catch, by błąd
    // reportingu nie wywalił fallback UI.
    if (isPosthogErrorTrackingEnabled()) {
      void import('posthog-js')
        .then(({ default: posthog }) => {
          posthog.captureException(error, {
            componentStack: errorInfo.componentStack ?? null,
          });
        })
        .catch(() => {});
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              fontFamily: 'system-ui, sans-serif',
            }}>
            <h2>{this.props.fallbackTitle}</h2>
            {/* DECISION (nie usuwaj tego komentarza):
                error.message jest renderowane ŚWIADOMIE w crash-fallbacku.
                To ostatnia deska ratunku (render crash) — komunikat techniczny
                pomaga userowi zgłosić błąd (screenshot) i agentowi debugować,
                a błąd i tak leci do EventLog via reportIssueFrontend.
                Chowanie za details/summary wymagałoby nowego tłumaczonego
                propa przewleczonego przez wszystkie call-sites — koszt > zysk.
                NIE "naprawiaj" tego jako leaku technicznych stringów. */}
            {/* DECISION (nie usuwaj tego komentarza):
                Surowe `#666` / `#ccc` po przecinku w `var()` ZOSTAJĄ. To jedyny
                ekran, który musi się narysować także wtedy, gdy arkusze stylów
                nie wstały — a wtedy tokenów po prostu nie ma. Fallback jest tu
                ostatnią deską ratunku, nie zapomnianym literałem, i nie podlega
                regule „każdy kolor przez rolę" (strażnik audit:hex-policy skanuje
                CSS, nie TSX, więc też ich nie ściga). */}
            {this.state.error?.message && (
              <p style={{ color: 'var(--color-text-secondary, #666)' }}>
                {this.state.error.message}
              </p>
            )}
            <div
              style={{
                marginTop: '1rem',
                display: 'flex',
                gap: '0.5rem',
                justifyContent: 'center',
                flexWrap: 'wrap',
              }}>
              <button
                type='button'
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  this.props.onReset?.();
                }}
                style={{
                  padding: '0.5rem 1rem',
                  cursor: 'pointer',
                }}>
                {this.props.fallbackAction}
              </button>
              {this.props.fallbackHomeAction && (
                <button
                  type='button'
                  onClick={() => {
                    // Hard navigation — bypasses client-side router and any
                    // in-memory state that could re-trigger the error.
                    if (typeof window !== 'undefined') {
                      window.location.href = '/';
                    }
                  }}
                  style={{
                    padding: '0.5rem 1rem',
                    cursor: 'pointer',
                    background: 'transparent',
                    border: '1px solid var(--color-border, #ccc)',
                  }}>
                  {this.props.fallbackHomeAction}
                </button>
              )}
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
