// Single source of truth for stylist activation state. Four milestones map to REAL signals:
//   step1 photo   -> photo_count >= 1
//   step2 profile -> a PINNED visible work + public name and city
//   step3 pair    -> paired_client_count >= 1
//   step4 session -> pending_shares_count >= 1  (a client shared a session TO this stylist)
//
// DECISION: the "public profile" step is measured by a PINNED WORK, not by the bio: the public
// profile renders only pinned records (up to the plan ceiling), so an empty profile with a nice
// bio is not "ready". (owner)
//
// DECISION: HIGH-WATER LATCH. pending_shares_count is a LIVE count (drops back to 0 after the
// SHARED expiry); without a latch the activation card would REAPPEAR one step lower. A per-account
// high-water mark in localStorage keeps each milestone; the card retires permanently at
// ACTIVATION_STEP_COUNT/ACTIVATION_STEP_COUNT. A cross-device signal would need a denormalized
// first_session_received_at flag; the local latch degrades to the live signal if storage is denied.

import { useEffect, useState } from 'react';
import {
  getLocalStorage,
  setLocalStorage,
} from '../../../../application/client-device-storage/local-storage-adapter/localStorage.adapter';
import { activationLatchKey } from '../../../../application/client-device-storage/storage-keys.config';

export interface ActivationProgress {
  photo: boolean;
  profile: boolean;
  pair: boolean;
  session: boolean;
  /** 0..4 — endowed account step is NOT counted (it is always complete). */
  doneCount: number;
  isComplete: boolean;
}

/** Steps counted toward progress (the "account ready" step is outside the counter). */
const ACTIVATION_STEP_COUNT = 4;

interface Latch {
  photo?: boolean;
  profile?: boolean;
  pair?: boolean;
  session?: boolean;
}

function readLatch(accountId: string): Latch {
  try {
    const raw = getLocalStorage(activationLatchKey(accountId));
    if (!raw) {
      return {};
    }
    // Valid JSON is not a valid shape: `null`/number/array parse without
    // throwing, and a bare cast would let them reach `.photo` outside the catch.
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    const obj = parsed as Record<string, unknown>;
    return {
      ...(obj['photo'] === true && { photo: true }),
      ...(obj['profile'] === true && { profile: true }),
      ...(obj['pair'] === true && { pair: true }),
      ...(obj['session'] === true && { session: true }),
    };
  } catch {
    return {};
  }
}

export interface ActivationSignals {
  photoCount: number;
  /** Visible works pinned to the public profile (`pinned_count` from the feed). */
  pinnedCount: number;
  /** Public name and city are filled in. Onboarding does not ask for them (owner),
   *  so the profile step is not done without them and the list reminds a stylist
   *  who skipped the dialog after the first photo. */
  profileDetailsComplete: boolean;
  pairedClientCount: number;
  pendingSharesCount: number;
  /** `currentUser.id`, the per-account latch key. */
  accountId: string | undefined;
}

export function useActivationProgress({
  photoCount,
  pinnedCount,
  profileDetailsComplete,
  pairedClientCount,
  pendingSharesCount,
  accountId,
}: ActivationSignals): ActivationProgress {
  const livePhoto = photoCount >= 1;
  const liveProfile = pinnedCount >= 1 && profileDetailsComplete;
  const livePair = pairedClientCount >= 1;
  const liveSession = pendingSharesCount >= 1;

  // Latched (high-water) milestones — hydrated from storage on the client, then
  // OR-ed with the live signal so a milestone never regresses once reached.
  const [latch, setLatch] = useState<{
    accountId: string | undefined;
    values: Latch;
  }>({ accountId: undefined, values: {} });

  useEffect(() => {
    if (!accountId || typeof window === 'undefined') {
      return;
    }
    const stored = readLatch(accountId);
    const merged: Latch = {
      photo: stored.photo === true || livePhoto,
      profile: stored.profile === true || liveProfile,
      pair: stored.pair === true || livePair,
      session: stored.session === true || liveSession,
    };
    setLatch({ accountId, values: merged });
    try {
      setLocalStorage(activationLatchKey(accountId), JSON.stringify(merged));
    } catch {
      // storage denied (private mode / quota) — degrade to live signal only.
    }
    // latch intentionally NOT a dep: the effect only reads storage + the live
    // booleans, so there is no update loop.
  }, [accountId, livePhoto, liveProfile, livePair, liveSession]);

  const currentLatch = latch.accountId === accountId ? latch.values : {};
  const photo = livePhoto || currentLatch.photo === true;
  const profile = liveProfile || currentLatch.profile === true;
  const pair = livePair || currentLatch.pair === true;
  const session = liveSession || currentLatch.session === true;
  const doneCount =
    (photo ? 1 : 0) + (profile ? 1 : 0) + (pair ? 1 : 0) + (session ? 1 : 0);

  return {
    photo,
    profile,
    pair,
    session,
    doneCount,
    isComplete: doneCount === ACTIVATION_STEP_COUNT,
  };
}
