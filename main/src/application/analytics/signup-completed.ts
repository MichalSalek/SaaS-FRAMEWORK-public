import {
  getLocalStorage,
  setLocalStorage,
} from '../client-device-storage/local-storage-adapter/localStorage.adapter';
import { signupCompletedKey } from '../client-device-storage/storage-keys.config';
import { emitAnalyticsEvent } from './analytics-sinks';
import { getFirstTouchEventProperties } from './first-touch';
import { usePostHogReadinessStore } from './posthog-readiness.store';

type SignupRole = 'client' | 'stylist';

interface PendingSignup {
  role: SignupRole;
  userId: string;
}

const pendingSignups = new Map<string, PendingSignup>();

// DECISION: the conversion waits for PostHog readiness and identification of the same userId;
// fired immediately, signup_completed preceded identify by about 0.4 s and landed on an anonymous
// person.

function isAlreadyTracked(userId: string): boolean {
  try {
    return getLocalStorage(signupCompletedKey(userId)) !== null;
  } catch {
    return false;
  }
}

function markTracked(userId: string): void {
  try {
    setLocalStorage(signupCompletedKey(userId), '1');
  } catch {
    // The in-memory queue still deduplicates this page if storage is unavailable.
  }
}

function captureIfIdentified(userId: string, signup: PendingSignup): boolean {
  const readiness = usePostHogReadinessStore.getState();
  if (!readiness.isReady || readiness.identifiedUserId !== userId) {
    return false;
  }

  if (!isAlreadyTracked(userId)) {
    const firstTouch = getFirstTouchEventProperties();
    emitAnalyticsEvent('signup_completed', {
      role: signup.role,
      first_source: firstTouch.first_source,
      first_landing: firstTouch.first_landing,
      first_cta: firstTouch.first_cta,
      method: firstTouch.method,
    });
    markTracked(userId);
  }
  return true;
}

function flushPendingSignups(): void {
  for (const [userId, signup] of pendingSignups) {
    if (captureIfIdentified(userId, signup)) {
      pendingSignups.delete(userId);
    }
  }
}

usePostHogReadinessStore.subscribe(state => {
  if (state.isReady && state.identifiedUserId !== null) {
    flushPendingSignups();
  }
});

export function trackSignupCompleted(
  role: SignupRole,
  userId: string | null
): void {
  if (userId === null || userId.length === 0 || isAlreadyTracked(userId)) {
    return;
  }

  const signup: PendingSignup = { role, userId };
  if (captureIfIdentified(userId, signup)) {
    return;
  }
  pendingSignups.set(userId, signup);
}
