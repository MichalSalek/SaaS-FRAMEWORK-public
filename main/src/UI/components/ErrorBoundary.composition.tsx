// main/src/UI/components/ErrorBoundary.tsx
// React Error Boundary — catches render errors in the component tree.
// Must be a class component (React requires getDerivedStateFromError + componentDidCatch).

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { reportIssueFrontend } from '../../application/error-debugger/errorHandler.possibilities.api';
import { isPosthogErrorTrackingEnabled } from '../../application/analytics/analytics.config';
import { withPosthog } from '../../application/analytics/posthog-client';

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

    // PostHog Error Tracking (alongside EventLog). React render errors are caught by the boundary
    // and NOT re-thrown to window, so capture_unhandled_errors never sees them; the boundary must
    // send them by hand. PRODUCTION-only guard (consistent with capture_exceptions in
    // PostHogProvider): dev/staging => dead-code branch. Through posthog-client: a report made
    // before PostHog starts waits in the queue, and an error in the reporting itself is swallowed,
    // so it cannot break the fallback UI.
    if (isPosthogErrorTrackingEnabled()) {
      withPosthog(posthog => {
        posthog.captureException(error, {
          componentStack: errorInfo.componentStack ?? null,
        });
      });
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
            {/* DECISION: error.message is rendered DELIBERATELY in the crash fallback. It is the
                last resort (render crash): the technical message helps the user report the bug
                (screenshot) and an agent debug it, and the error reaches EventLog via
                reportIssueFrontend anyway. Hiding it behind details/summary would need a new
                translated prop threaded through every call site, cost > gain. Do NOT "fix" this
                as a technical-string leak. */}
            {/* DECISION: the raw `#666` / `#ccc` fallbacks inside `var()` STAY. This is the one
                screen that must render even when the stylesheets failed to load, when tokens
                simply do not exist; the fallback is the last resort, not a forgotten literal, and
                is exempt from "every color through a role" (css/hex-policy scans CSS, not TSX). */}
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
